//! Enterprise OIDC/SSO primitives. Provider-specific token verification remains fail-closed
//! until a configured issuer/JWKS validation path is supplied.
use rand::{rngs::OsRng,RngCore};
use serde::{Deserialize,Serialize};
use sha2::{Digest,Sha256};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD,Engine};

#[derive(Debug,Clone,Serialize,Deserialize)]
pub struct OidcConfig{pub issuer:String,pub client_id:String,pub redirect_uri:String,pub scopes:Vec<String>}
impl OidcConfig{pub fn from_env()->Result<Self,String>{let issuer=std::env::var("VARDHAN_OIDC_ISSUER").map_err(|_|"VARDHAN_OIDC_ISSUER is required".to_string())?;let client_id=std::env::var("VARDHAN_OIDC_CLIENT_ID").map_err(|_|"VARDHAN_OIDC_CLIENT_ID is required".to_string())?;let redirect_uri=std::env::var("VARDHAN_OIDC_REDIRECT_URI").map_err(|_|"VARDHAN_OIDC_REDIRECT_URI is required".to_string())?;Ok(Self{issuer,client_id,redirect_uri,scopes:vec!["openid".into(),"profile".into(),"email".into()]})}}

#[derive(Debug,Clone)] pub struct OidcLoginState{pub state:String,pub nonce:String,pub verifier:String}
impl OidcLoginState{pub fn generate()->Self{Self{state:random(),nonce:random(),verifier:random()}}pub fn challenge(&self)->String{URL_SAFE_NO_PAD.encode(Sha256::digest(self.verifier.as_bytes()))}}
fn random()->String{let mut b=[0u8;32];OsRng.fill_bytes(&mut b);URL_SAFE_NO_PAD.encode(b)}

/// Constructs the authorization parameters for Authorization Code + PKCE S256.
pub fn authorization_params(config:&OidcConfig,s:&OidcLoginState)->Vec<(String,String)>{vec![("response_type".into(),"code".into()),("client_id".into(),config.client_id.clone()),("redirect_uri".into(),config.redirect_uri.clone()),("scope".into(),config.scopes.join(" ")),("state".into(),s.state.clone()),("nonce".into(),s.nonce.clone()),("code_challenge".into(),s.challenge()),("code_challenge_method".into(),"S256".into())]}

#[cfg(test)]mod tests{use super::*;#[test]fn pkce_is_s256_and_state_is_unpredictable(){let a=OidcLoginState::generate();let b=OidcLoginState::generate();assert_ne!(a.state,b.state);assert_ne!(a.nonce,b.nonce);assert_ne!(a.challenge(),b.challenge());assert!(!a.challenge().is_empty());}}
