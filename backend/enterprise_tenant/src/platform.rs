use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use thiserror::Error;

#[derive(Error, Debug, Clone, PartialEq, Eq)]
pub enum PlatformError {
    #[error("tenant not found: {0}")]
    TenantNotFound(String),
    #[error("user not found: {0}")]
    UserNotFound(String),
    #[error("project not found: {0}")]
    ProjectNotFound(String),
    #[error("resource already exists: {0}")]
    AlreadyExists(String),
    #[error("forbidden")]
    Forbidden,
    #[error("not found: {0}")]
    NotFound(String),
    #[error("invalid state: {0}")]
    InvalidState(String),
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SecurityLevel {
    Foundation,
    Protected,
    Enterprise,
    HighAssurance,
    Critical,
    Resilience,
    Sovereign,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Role {
    Owner,
    SecurityAdmin,
    Auditor,
    Operator,
    Analyst,
    Viewer,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Permission {
    ManageUsers,
    ManagePolicy,
    ManageAssets,
    ReadAudit,
    ExecuteTransaction,
    ManageIntegrations,
    ManageKeys,
}

impl Role {
    fn allows(self, permission: Permission) -> bool {
        match self {
            Role::Owner => true,
            Role::SecurityAdmin => matches!(
                permission,
                Permission::ManageUsers
                    | Permission::ManagePolicy
                    | Permission::ManageAssets
                    | Permission::ReadAudit
                    | Permission::ManageIntegrations
                    | Permission::ManageKeys
            ),
            Role::Auditor => matches!(permission, Permission::ReadAudit),
            Role::Operator => matches!(
                permission,
                Permission::ManageAssets | Permission::ExecuteTransaction | Permission::ReadAudit
            ),
            Role::Analyst => matches!(permission, Permission::ReadAudit | Permission::ManageAssets),
            Role::Viewer => matches!(permission, Permission::ReadAudit),
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct TenantSpec {
    pub id: String,
    pub name: String,
    pub security_level: SecurityLevel,
    pub enabled: bool,
}
impl TenantSpec {
    pub fn new(
        id: impl Into<String>,
        name: impl Into<String>,
        security_level: SecurityLevel,
    ) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            security_level,
            enabled: true,
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct UserSpec {
    pub id: String,
    pub email: String,
    pub enabled: bool,
}
impl UserSpec {
    pub fn new(id: impl Into<String>, email: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            email: email.into(),
            enabled: true,
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Project {
    pub id: String,
    pub tenant_id: String,
    pub owner: String,
}
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Environment {
    pub id: String,
    pub project_id: String,
    pub name: String,
}
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Asset {
    pub id: String,
    pub tenant_id: String,
    pub project_id: String,
    pub class: String,
    pub criticality: u8,
}
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SecurityPolicy {
    pub id: String,
    pub tenant_id: String,
    pub name: String,
    pub enabled: bool,
    pub version: u64,
}
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Entitlement {
    pub tenant_id: String,
    pub tier: String,
    pub expires_at: Option<String>,
    pub features: HashSet<String>,
}
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AuditEvent {
    pub tenant_id: String,
    pub actor: String,
    pub action: String,
    pub resource: String,
    pub outcome: String,
}
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Notification {
    pub tenant_id: String,
    pub topic: String,
    pub message: String,
    pub severity: String,
}

#[derive(Default)]
pub struct ControlPlane {
    pub(crate) tenants: std::sync::Mutex<HashMap<String, TenantSpec>>,
    pub(crate) users: std::sync::Mutex<HashMap<String, UserSpec>>,
    pub(crate) roles: std::sync::Mutex<HashMap<(String, String), HashSet<Role>>>,
    projects: std::sync::Mutex<HashMap<String, Project>>,
    environments: std::sync::Mutex<HashMap<String, Environment>>,
    assets: std::sync::Mutex<HashMap<String, Asset>>,
    policies: std::sync::Mutex<HashMap<String, SecurityPolicy>>,
    entitlements: std::sync::Mutex<HashMap<String, Entitlement>>,
    audit: std::sync::Mutex<Vec<AuditEvent>>,
    notifications: std::sync::Mutex<Vec<Notification>>,
}

impl ControlPlane {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn create_tenant(&self, spec: TenantSpec) -> Result<(), PlatformError> {
        let mut g = self.tenants.lock().unwrap();
        if g.contains_key(&spec.id) {
            return Err(PlatformError::AlreadyExists(spec.id));
        }
        g.insert(spec.id.clone(), spec);
        Ok(())
    }
    pub fn create_user(&self, spec: UserSpec) -> Result<(), PlatformError> {
        let mut g = self.users.lock().unwrap();
        if g.contains_key(&spec.id) {
            return Err(PlatformError::AlreadyExists(spec.id));
        }
        g.insert(spec.id.clone(), spec);
        Ok(())
    }
    pub fn assign_role(
        &self,
        tenant_id: &str,
        user_id: &str,
        role: Role,
    ) -> Result<(), PlatformError> {
        self.require_tenant(tenant_id)?;
        self.require_user(user_id)?;
        self.roles
            .lock()
            .unwrap()
            .entry((tenant_id.into(), user_id.into()))
            .or_default()
            .insert(role);
        Ok(())
    }
    pub fn create_project(
        &self,
        tenant_id: &str,
        project_id: &str,
        owner: &str,
    ) -> Result<(), PlatformError> {
        self.require_tenant(tenant_id)?;
        self.require_user(owner)?;
        let mut g = self.projects.lock().unwrap();
        if g.contains_key(project_id) {
            return Err(PlatformError::AlreadyExists(project_id.into()));
        }
        g.insert(
            project_id.into(),
            Project {
                id: project_id.into(),
                tenant_id: tenant_id.into(),
                owner: owner.into(),
            },
        );
        Ok(())
    }
    pub fn create_environment(
        &self,
        tenant_id: &str,
        project_id: &str,
        name: &str,
        actor: &str,
    ) -> Result<(), PlatformError> {
        let p = self
            .projects
            .lock()
            .unwrap()
            .get(project_id)
            .cloned()
            .ok_or_else(|| PlatformError::ProjectNotFound(project_id.into()))?;
        if p.tenant_id != tenant_id
            || !self.authorize(tenant_id, actor, Permission::ManageAssets, project_id)?
        {
            return Err(PlatformError::Forbidden);
        }
        let id = format!("{project_id}:{name}");
        let mut g = self.environments.lock().unwrap();
        if g.contains_key(&id) {
            return Err(PlatformError::AlreadyExists(id));
        }
        g.insert(
            id.clone(),
            Environment {
                id,
                project_id: project_id.into(),
                name: name.into(),
            },
        );
        Ok(())
    }
    pub fn register_asset(&self, asset: Asset, actor: &str) -> Result<(), PlatformError> {
        self.require_tenant(&asset.tenant_id)?;
        if !self.authorize(
            &asset.tenant_id,
            actor,
            Permission::ManageAssets,
            &asset.project_id,
        )? {
            return Err(PlatformError::Forbidden);
        }
        let mut g = self.assets.lock().unwrap();
        if g.contains_key(&asset.id) {
            return Err(PlatformError::AlreadyExists(asset.id));
        }
        g.insert(asset.id.clone(), asset);
        Ok(())
    }
    pub fn upsert_policy(&self, policy: SecurityPolicy, actor: &str) -> Result<(), PlatformError> {
        if !self.authorize(&policy.tenant_id, actor, Permission::ManagePolicy, "*")? {
            return Err(PlatformError::Forbidden);
        }
        self.policies
            .lock()
            .unwrap()
            .insert(policy.id.clone(), policy);
        Ok(())
    }
    pub fn set_entitlement(&self, entitlement: Entitlement) -> Result<(), PlatformError> {
        self.require_tenant(&entitlement.tenant_id)?;
        self.entitlements
            .lock()
            .unwrap()
            .insert(entitlement.tenant_id.clone(), entitlement);
        Ok(())
    }
    pub fn authorize(
        &self,
        tenant_id: &str,
        user_id: &str,
        permission: Permission,
        project_id: &str,
    ) -> Result<bool, PlatformError> {
        self.require_tenant(tenant_id)?;
        self.require_user(user_id)?;
        if !self
            .users
            .lock()
            .unwrap()
            .get(user_id)
            .map(|u| u.enabled)
            .unwrap_or(false)
        {
            return Ok(false);
        }
        let roles = self
            .roles
            .lock()
            .unwrap()
            .get(&(tenant_id.into(), user_id.into()))
            .cloned()
            .unwrap_or_default();
        if !roles.iter().copied().any(|r| r.allows(permission)) {
            return Ok(false);
        }
        if project_id == "*" {
            return Ok(true);
        }
        let p = self.projects.lock().unwrap().get(project_id).cloned();
        Ok(p.map(|p| {
            p.tenant_id == tenant_id
                && (p.owner == user_id
                    || roles.contains(&Role::Owner)
                    || roles.contains(&Role::SecurityAdmin))
        })
        .unwrap_or(false))
    }
    pub fn audit(&self, event: AuditEvent) {
        self.audit.lock().unwrap().push(event);
    }
    pub fn notify(&self, notification: Notification) {
        self.notifications.lock().unwrap().push(notification);
    }
    pub(crate) fn require_tenant(&self, id: &str) -> Result<(), PlatformError> {
        if self.tenants.lock().unwrap().contains_key(id) {
            Ok(())
        } else {
            Err(PlatformError::TenantNotFound(id.into()))
        }
    }
    pub(crate) fn require_user(&self, id: &str) -> Result<(), PlatformError> {
        if self.users.lock().unwrap().contains_key(id) {
            Ok(())
        } else {
            Err(PlatformError::UserNotFound(id.into()))
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Industry {
    Banking,
    Healthcare,
    Government,
    Telecom,
    Energy,
    Insurance,
    Education,
}
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct IndustryControl {
    pub id: String,
    pub title: String,
    pub severity: String,
}
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct IndustryPackage {
    pub industry: Industry,
    pub controls: Vec<IndustryControl>,
    pub required_integrations: Vec<IntegrationKind>,
    pub workflows: Vec<String>,
    pub dashboards: Vec<String>,
}
pub struct IndustryRegistry {
    packages: HashMap<Industry, IndustryPackage>,
}
impl IndustryRegistry {
    pub fn packages(&self) -> Vec<&IndustryPackage> {
        self.packages.values().collect()
    }
    pub fn get(&self, industry: Industry) -> Option<&IndustryPackage> {
        self.packages.get(&industry)
    }
}
impl Default for IndustryRegistry {
    fn default() -> Self {
        let mut packages = HashMap::new();
        let specs = [
            (
                Industry::Banking,
                "BANK-PQ-001",
                "Payments and transaction integrity",
            ),
            (
                Industry::Healthcare,
                "HEALTH-PQ-001",
                "Patient and clinical data protection",
            ),
            (
                Industry::Government,
                "GOV-PQ-001",
                "Sovereign and sensitive-system protection",
            ),
            (
                Industry::Telecom,
                "TELCO-PQ-001",
                "Network and subscriber protection",
            ),
            (
                Industry::Energy,
                "ENERGY-PQ-001",
                "OT and critical infrastructure resilience",
            ),
            (
                Industry::Insurance,
                "INS-PQ-001",
                "Policy, claims and customer protection",
            ),
            (
                Industry::Education,
                "EDU-PQ-001",
                "Research and institutional data protection",
            ),
        ];
        for (industry, id, title) in specs {
            packages.insert(
                industry,
                IndustryPackage {
                    industry,
                    controls: vec![IndustryControl {
                        id: id.into(),
                        title: title.into(),
                        severity: "high".into(),
                    }],
                    required_integrations: vec![IntegrationKind::Siem, IntegrationKind::Kms],
                    workflows: vec![
                        "asset-assessment".into(),
                        "crypto-posture".into(),
                        "incident-response".into(),
                    ],
                    dashboards: vec!["executive".into(), "security".into(), "compliance".into()],
                },
            );
        }
        Self { packages }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct RiskFinding {
    pub id: String,
    pub asset_id: String,
    pub category: String,
    pub score: u8,
    pub status: String,
}
impl RiskFinding {
    pub fn new(asset_id: impl Into<String>, category: impl Into<String>, score: u8) -> Self {
        let asset_id = asset_id.into();
        Self {
            id: format!("finding-{asset_id}"),
            asset_id,
            category: category.into(),
            score: score.min(100),
            status: "open".into(),
        }
    }
}
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
pub enum IncidentStatus {
    Open,
    Contained,
    Resolved,
}
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Incident {
    pub id: String,
    pub finding_id: String,
    pub status: IncidentStatus,
}
#[derive(Serialize, Deserialize, Debug, Clone, Copy)]
pub enum RemediationAction {
    QuarantineAsset,
    RotateKeys,
    DisableIdentity,
    RestoreFromBackup,
}
#[derive(Default)]
pub struct SecurityOperations {
    findings: HashMap<String, RiskFinding>,
    incidents: HashMap<String, Incident>,
}
impl SecurityOperations {
    pub fn ingest_finding(&mut self, finding: RiskFinding) -> RiskFinding {
        self.findings.insert(finding.id.clone(), finding.clone());
        finding
    }
    pub fn risk_score(&self, asset_id: &str) -> Option<u8> {
        self.findings
            .values()
            .find(|f| f.asset_id == asset_id)
            .map(|f| f.score)
    }
    pub fn open_incident_from_finding(
        &mut self,
        finding: &RiskFinding,
    ) -> Result<Incident, PlatformError> {
        let id = format!("incident-{}", finding.id);
        let i = Incident {
            id: id.clone(),
            finding_id: finding.id.clone(),
            status: IncidentStatus::Open,
        };
        self.incidents.insert(id, i.clone());
        Ok(i)
    }
    pub fn apply_remediation(
        &mut self,
        incident_id: &str,
        action: RemediationAction,
    ) -> Result<(), PlatformError> {
        let i = self
            .incidents
            .get_mut(incident_id)
            .ok_or_else(|| PlatformError::NotFound(incident_id.into()))?;
        i.status = match action {
            RemediationAction::RestoreFromBackup => IncidentStatus::Resolved,
            _ => IncidentStatus::Contained,
        };
        Ok(())
    }
    pub fn incident(&self, id: &str) -> Option<&Incident> {
        self.incidents.get(id)
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ComplianceControl {
    pub id: String,
    pub title: String,
    pub required: bool,
}
impl ComplianceControl {
    pub fn new(id: impl Into<String>, title: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            title: title.into(),
            required: true,
        }
    }
}
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Evidence {
    pub id: String,
    pub control_id: String,
    pub artifact: String,
}
impl Evidence {
    pub fn new(
        id: impl Into<String>,
        control_id: impl Into<String>,
        artifact: impl Into<String>,
    ) -> Self {
        Self {
            id: id.into(),
            control_id: control_id.into(),
            artifact: artifact.into(),
        }
    }
}
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Vulnerability {
    pub id: String,
    pub severity: String,
    pub resolved: bool,
}
impl Vulnerability {
    pub fn new(id: impl Into<String>, severity: impl Into<String>, resolved: bool) -> Self {
        Self {
            id: id.into(),
            severity: severity.into(),
            resolved,
        }
    }
}
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SbomComponent {
    pub name: String,
    pub version: String,
    pub license: String,
}
#[derive(Default)]
pub struct AssuranceEngine {
    controls: HashMap<String, ComplianceControl>,
    evidence: Vec<Evidence>,
    vulnerabilities: HashMap<String, Vulnerability>,
    sbom: Vec<SbomComponent>,
}
impl AssuranceEngine {
    pub fn add_control(&mut self, c: ComplianceControl) -> Result<(), PlatformError> {
        if self.controls.contains_key(&c.id) {
            return Err(PlatformError::AlreadyExists(c.id));
        }
        self.controls.insert(c.id.clone(), c);
        Ok(())
    }
    pub fn add_evidence(&mut self, e: Evidence) -> Result<(), PlatformError> {
        if !self.controls.contains_key(&e.control_id) {
            return Err(PlatformError::NotFound(e.control_id));
        }
        self.evidence.push(e);
        Ok(())
    }
    pub fn add_vulnerability(&mut self, v: Vulnerability) -> Result<(), PlatformError> {
        self.vulnerabilities.insert(v.id.clone(), v);
        Ok(())
    }
    pub fn resolve_vulnerability(&mut self, id: &str) -> Result<(), PlatformError> {
        self.vulnerabilities
            .get_mut(id)
            .ok_or_else(|| PlatformError::NotFound(id.into()))
            .map(|v| v.resolved = true)
    }
    pub fn add_sbom_component(&mut self, c: SbomComponent) {
        self.sbom.push(c)
    }
    pub fn release_gate_passes(&self) -> bool {
        self.vulnerabilities
            .values()
            .all(|v| v.resolved || (v.severity != "critical" && v.severity != "high"))
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum IntegrationKind {
    Iam,
    Siem,
    Cloud,
    Kubernetes,
    Database,
    Network,
    Kms,
    Hsm,
    Itsm,
    Edr,
}
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct IntegrationConfig {
    pub tenant_id: String,
    pub id: String,
    pub kind: IntegrationKind,
    pub enabled: bool,
}
impl IntegrationConfig {
    pub fn new(tenant_id: impl Into<String>, id: impl Into<String>, kind: IntegrationKind) -> Self {
        Self {
            tenant_id: tenant_id.into(),
            id: id.into(),
            kind,
            enabled: true,
        }
    }
}
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
pub enum IntegrationHealth {
    Unknown,
    Healthy,
    Degraded,
    Failed,
}
#[derive(Default)]
pub struct IntegrationRegistry {
    configs: HashMap<String, IntegrationConfig>,
    health: HashMap<String, IntegrationHealth>,
}
impl IntegrationRegistry {
    pub fn register(&mut self, c: IntegrationConfig) -> Result<String, PlatformError> {
        if self.configs.contains_key(&c.id) {
            return Err(PlatformError::AlreadyExists(c.id));
        }
        let id = c.id.clone();
        self.configs.insert(id.clone(), c);
        self.health.insert(id.clone(), IntegrationHealth::Unknown);
        Ok(id)
    }
    pub fn set_health(&mut self, id: &str, health: IntegrationHealth) -> Result<(), PlatformError> {
        if !self.configs.contains_key(id) {
            return Err(PlatformError::NotFound(id.into()));
        }
        self.health.insert(id.into(), health);
        Ok(())
    }
    pub fn healthy_count(&self, tenant_id: &str) -> usize {
        self.configs
            .values()
            .filter(|c| {
                c.tenant_id == tenant_id
                    && self.health.get(&c.id) == Some(&IntegrationHealth::Healthy)
            })
            .count()
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ClusterNode {
    pub id: String,
    pub region: String,
    pub healthy: bool,
}
impl ClusterNode {
    pub fn new(id: impl Into<String>, region: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            region: region.into(),
            healthy: true,
        }
    }
}
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct BackupRecord {
    pub id: String,
    pub label: String,
    pub checksum: String,
    pub verified: bool,
}
#[derive(Default)]
pub struct ResilienceManager {
    nodes: HashMap<String, ClusterNode>,
    leader: Option<String>,
    backups: HashMap<String, BackupRecord>,
    key_epoch: u64,
}
impl ResilienceManager {
    pub fn register_node(&mut self, node: ClusterNode) -> Result<(), PlatformError> {
        if self.nodes.contains_key(&node.id) {
            return Err(PlatformError::AlreadyExists(node.id));
        }
        self.nodes.insert(node.id.clone(), node);
        Ok(())
    }
    pub fn elect_leader(&mut self, id: &str) -> Result<(), PlatformError> {
        let n = self
            .nodes
            .get(id)
            .ok_or_else(|| PlatformError::NotFound(id.into()))?;
        if !n.healthy {
            return Err(PlatformError::InvalidState("unhealthy node".into()));
        }
        if self.leader.is_some() {
            return Err(PlatformError::InvalidState(
                "leader already elected; failover must explicitly clear leadership".into(),
            ));
        }
        self.leader = Some(id.into());
        Ok(())
    }
    pub fn failover(&mut self, id: &str) -> Result<(), PlatformError> {
        self.leader = None;
        self.elect_leader(id)
    }
    pub fn create_backup(
        &mut self,
        label: &str,
        checksum: &str,
    ) -> Result<BackupRecord, PlatformError> {
        let id = format!("backup-{}", self.backups.len() + 1);
        let b = BackupRecord {
            id: id.clone(),
            label: label.into(),
            checksum: checksum.into(),
            verified: true,
        };
        self.backups.insert(id, b.clone());
        Ok(b)
    }
    pub fn backup(&self, id: &str) -> Option<&BackupRecord> {
        self.backups.get(id)
    }
    pub fn rotate_key_epoch(&mut self) -> u64 {
        self.key_epoch += 1;
        self.key_epoch
    }
}
