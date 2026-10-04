//! Restart-safe session store.
//! Secret bearer tokens are never persisted; only BLAKE3 token digests are stored.

use std::{net::IpAddr, path::Path, sync::Arc, time::{SystemTime, UNIX_EPOCH}};
use dashmap::DashMap;
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

pub use crate::authorization::{AuthenticatedUser, Permission, Role};

pub const SESSION_HARD_EXPIRY_SECS: u64 = 8 * 60 * 60;
pub const SESSION_IDLE_TIMEOUT_SECS: u64 = 30 * 60;

fn now_ms() -> u128 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() }
fn token_digest(token: &str) -> String { blake3::hash(token.as_bytes()).to_hex().to_string() }

#[derive(Debug, Clone, PartialEq, Eq, Hash, Zeroize, ZeroizeOnDrop)]
pub struct SessionToken(String);
impl SessionToken {
    pub fn generate() -> Self { let mut b=[0u8;32]; OsRng.fill_bytes(&mut b); Self(hex::encode(b)) }
    pub fn from_str(s:&str)->Self { Self(s.to_string()) }
    pub fn as_str(&self)->&str { &self.0 }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PersistedSession {
    session_id:String, username:String, created_at_ms:u128, last_activity_ms:u128,
    expires_at_ms:u128, ip:String, node_id:String, revoked:bool,
    current_token_digest:String, previous_token_digest:Option<String>,
}
impl PersistedSession { fn expired(&self)->bool { self.revoked || now_ms()>=self.expires_at_ms || now_ms().saturating_sub(self.last_activity_ms)>=(SESSION_IDLE_TIMEOUT_SECS as u128*1000) } }

#[derive(Debug, Clone)]
pub struct SessionEntry {
    pub session_id:String, pub username:String, pub created_at_ms:u128, pub last_activity_ms:u128,
    pub expires_at_ms:u128, pub ip:String, pub node_id:String, pub revoked:bool,
    pub current_token:Zeroizing<String>, pub previous_token:Option<Zeroizing<String>>,
}
impl SessionEntry {
    fn to_persisted(&self)->PersistedSession { PersistedSession { session_id:self.session_id.clone(), username:self.username.clone(), created_at_ms:self.created_at_ms, last_activity_ms:self.last_activity_ms, expires_at_ms:self.expires_at_ms, ip:self.ip.clone(), node_id:self.node_id.clone(), revoked:self.revoked, current_token_digest:token_digest(&self.current_token), previous_token_digest:self.previous_token.as_ref().map(|v|token_digest(v)), } }
    fn from_persisted(v:PersistedSession)->Self { Self { session_id:v.session_id, username:v.username, created_at_ms:v.created_at_ms, last_activity_ms:v.last_activity_ms, expires_at_ms:v.expires_at_ms, ip:v.ip, node_id:v.node_id, revoked:v.revoked, current_token:Zeroizing::new(String::new()), previous_token:None } }
    fn is_expired(&self)->bool { self.revoked || now_ms()>=self.expires_at_ms || now_ms().saturating_sub(self.last_activity_ms)>=(SESSION_IDLE_TIMEOUT_SECS as u128*1000) }
    fn to_view(&self)->SessionView { SessionView { session_id:self.session_id.clone(), username:self.username.clone(), created_at:self.created_at_ms, expires_at:self.expires_at_ms, last_activity:self.last_activity_ms, node_id:self.node_id.clone(), session_state:if self.revoked{"revoked"}else if self.is_expired(){"expired"}else{"active"}.into(), client_ip:self.ip.clone() } }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SessionView { pub session_id:String, pub username:String, pub created_at:u128, pub expires_at:u128, pub last_activity:u128, pub node_id:String, pub session_state:String, pub client_ip:String }
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo { pub username:String, pub issued_at_ms:u64, pub expires_in_secs:u64 }

#[derive(Clone)]
pub struct SessionStore {
    inner:Arc<DashMap<String,SessionEntry>>, token_to_id:Arc<DashMap<String,String>>, revoked:Arc<DashMap<String,SessionView>>, db:Option<sled::Db>,
}
impl Default for SessionStore { fn default()->Self{Self::new()} }
impl SessionStore {
    pub fn new()->Self { Self { inner:Arc::new(DashMap::new()), token_to_id:Arc::new(DashMap::new()), revoked:Arc::new(DashMap::new()), db:None } }
    pub fn open(path:&Path)->Result<Self,String> {
        let db=sled::open(path).map_err(|e|format!("session store open failed: {e}"))?;
        let s=Self { inner:Arc::new(DashMap::new()),token_to_id:Arc::new(DashMap::new()),revoked:Arc::new(DashMap::new()),db:Some(db.clone()) };
        for item in db.iter() { let (k,v)=item.map_err(|e|format!("session store read failed: {e}"))?; let p:PersistedSession=serde_json::from_slice(&v).map_err(|e|format!("session record decode failed: {e}"))?; let id=String::from_utf8_lossy(&k).to_string(); if p.revoked { s.revoked.insert(id,p.clone().into_view()); } else if !p.expired() { s.inner.insert(id,p.into_entry()); } else { let _=db.remove(k); } }
        Ok(s)
    }
    fn persist(&self,e:&SessionEntry)->Result<(),String>{ if let Some(db)=&self.db { let p=e.to_persisted(); db.insert(e.session_id.as_bytes(),serde_json::to_vec(&p).map_err(|x|x.to_string())?).map_err(|x|x.to_string())?; db.flush().map_err(|x|x.to_string())?; } Ok(()) }
    fn delete(&self,id:&str){ if let Some(db)=&self.db { let _=db.remove(id.as_bytes()); let _=db.flush(); } }
    pub async fn create(&self,username:&str,ip:IpAddr)->SessionToken{self.create_with_node(username,ip,"local-node").await}
    pub async fn create_with_node(&self,username:&str,ip:IpAddr,node_id:&str)->SessionToken{
        let token=SessionToken::generate(); let mut b=[0u8;8];OsRng.fill_bytes(&mut b); let id=format!("sess_{}",hex::encode(b)); let now=now_ms();
        let e=SessionEntry{session_id:id.clone(),username:username.into(),created_at_ms:now,last_activity_ms:now,expires_at_ms:now+(SESSION_HARD_EXPIRY_SECS as u128*1000),ip:ip.to_string(),node_id:node_id.into(),revoked:false,current_token:Zeroizing::new(token.as_str().into()),previous_token:None};
        let _=self.persist(&e); self.inner.insert(id.clone(),e); self.token_to_id.insert(token_digest(token.as_str()),id); token
    }
    pub async fn validate_and_rotate(&self,token:&SessionToken)->Option<(String,SessionToken)>{
        let d=token_digest(token.as_str()); let id=self.token_to_id.get(&d)?.clone(); let mut e=self.inner.get_mut(&id)?; if e.is_expired(){drop(e);self.remove(token).await;return None;}
        if d==token_digest(&e.current_token){let nt=SessionToken::generate();let old=e.current_token.clone();e.previous_token=Some(old);e.current_token=Zeroizing::new(nt.as_str().into());e.last_activity_ms=now_ms();let u=e.username.clone();let persisted=e.clone();drop(e);self.persist(&persisted).ok()?;self.token_to_id.remove(&d);self.token_to_id.insert(token_digest(nt.as_str()),id);Some((u,nt))}
        else if e.previous_token.as_ref().map(|v|token_digest(v))==Some(d){e.last_activity_ms=now_ms();let u=e.username.clone();let cur=SessionToken::from_str(&e.current_token);let p=e.clone();drop(e);self.persist(&p).ok()?;Some((u,cur))}
        else {drop(e);self.revoke_by_id(&id).await.map(|_|(String::new(),SessionToken::from_str(""))).filter(|_|false)}
    }
    pub async fn validate(&self,token:&SessionToken)->Option<String>{let d=token_digest(token.as_str());let id=self.token_to_id.get(&d)?.clone();let e=self.inner.get(&id)?;if e.is_expired(){return None} if d==token_digest(&e.current_token)||e.previous_token.as_ref().map(|v|token_digest(v))==Some(d){Some(e.username.clone())}else{None}}
    pub async fn remove(&self,token:&SessionToken)->Option<SessionEntry>{let d=token_digest(token.as_str());let (_,id)=self.token_to_id.remove(&d)?;let (_,e)=self.inner.remove(&id)?;self.delete(&id);Some(e)}
    pub async fn get_info(&self,token:&SessionToken)->Option<SessionInfo>{let u=self.validate(token).await?;let d=token_digest(token.as_str());let id=self.token_to_id.get(&d)?.clone();let e=self.inner.get(&id)?;Some(SessionInfo{username:u,issued_at_ms:e.created_at_ms as u64,expires_in_secs:e.expires_at_ms.saturating_sub(now_ms()) as u64/1000})}
    pub async fn list_sessions(&self)->Vec<SessionView>{let mut v=self.inner.iter().map(|e|e.value().to_view()).collect::<Vec<_>>();v.extend(self.revoked.iter().map(|e|e.value().clone()));v.sort_by(|a,b|b.created_at.cmp(&a.created_at));v}
    pub async fn get_session_by_id(&self,id:&str)->Option<SessionView>{self.revoked.get(id).map(|v|v.clone()).or_else(||self.inner.get(id).map(|e|e.to_view()))}
    pub async fn revoke_by_id(&self,id:&str)->Option<SessionView>{if let Some(v)=self.revoked.get(id){return Some(v.clone())} let (_,mut e)=self.inner.remove(id)?;e.revoked=true;self.token_to_id.remove(&token_digest(&e.current_token));if let Some(p)=&e.previous_token{self.token_to_id.remove(&token_digest(p));}let v=e.to_view();self.revoked.insert(id.into(),v.clone());self.persist(&e).ok()?;Some(v)}
    pub async fn flush_except(&self,preserve:Option<&str>)->usize{let ids=self.inner.iter().filter(|e|{let p=preserve.map(token_digest);p.as_ref().map(|x|x==&token_digest(&e.current_token)||e.previous_token.as_ref().map(|v|x==&token_digest(v)).unwrap_or(false)).unwrap_or(false)==false}).map(|e|e.key().clone()).collect::<Vec<_>>();let mut n=0;for id in ids{if self.revoke_by_id(&id).await.is_some(){n+=1}}n}
    pub fn active_count(&self)->usize{self.inner.iter().filter(|e|!e.is_expired()).count()}
}
impl PersistedSession { fn into_entry(self)->SessionEntry{SessionEntry::from_persisted(self)} fn into_view(self)->SessionView{SessionView{session_id:self.session_id,username:self.username,created_at:self.created_at_ms,expires_at:self.expires_at_ms,last_activity:self.last_activity_ms,node_id:self.node_id,session_state:if self.revoked{"revoked"}else{"expired"}.into(),client_ip:self.ip}} }
impl From<PersistedSession> for SessionView { fn from(v:PersistedSession)->Self{v.into_view()} }

#[cfg(test)]
mod tests { use super::*; use tempfile::tempdir;
 #[tokio::test] async fn create_validate(){let s=SessionStore::new();let t=s.create("alice","127.0.0.1".parse().unwrap()).await;assert_eq!(s.validate(&t).await.as_deref(),Some("alice"));}
 #[tokio::test] async fn restart_survives_without_persisting_token(){let d=tempdir().unwrap();let t={let s=SessionStore::open(d.path()).unwrap();s.create("alice","127.0.0.1".parse().unwrap()).await};let s2=SessionStore::open(d.path()).unwrap();assert_eq!(s2.active_count(),1);assert!(s2.validate(&t).await.is_none());}
 #[tokio::test] async fn invalid_rejected(){let s=SessionStore::new();assert!(s.validate(&SessionToken::from_str(&"0".repeat(64))).await.is_none());}
}
