use serde::Deserialize;

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct Category {
    pub id: i64,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub parent_id: Option<i64>,
    #[serde(default)]
    pub depth: u32,
    #[serde(default)]
    pub child_count: u32,
    #[serde(default)]
    pub media_count: u32,
    #[serde(default)]
    pub path: Option<String>,
}
