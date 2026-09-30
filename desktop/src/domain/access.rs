use serde::Deserialize;

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct AccessStatus {
    #[serde(default)]
    pub tier: i32,
    #[serde(default, rename = "firstRun")]
    pub first_run: bool,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub ip: Option<String>,
}
