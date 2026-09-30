use serde::{Deserialize, Serialize};

use super::Media;

#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct QueueItem {
    #[serde(flatten)]
    pub media: Media,
    #[serde(default)]
    pub position: Option<usize>,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QueueWindow {
    #[serde(default)]
    pub items: Vec<QueueItem>,
    pub offset: usize,
    pub total: usize,
    pub current_index: usize,
    #[serde(default)]
    pub current_media_id: Option<i64>,
    #[serde(default)]
    pub has_previous: bool,
    #[serde(default)]
    pub has_next: bool,
    pub revision: u64,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct QueueSelection {
    #[serde(default)]
    pub media_id: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueOrder<'a> {
    pub offset: usize,
    pub revision: u64,
    pub media_ids: &'a [i64],
}
