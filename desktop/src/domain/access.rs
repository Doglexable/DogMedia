use serde::Deserialize;

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct AccessStatus {
    #[serde(default)]
    pub tier: i32,
    #[serde(default)]
    pub description: Option<String>,
}
