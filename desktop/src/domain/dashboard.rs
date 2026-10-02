use serde::Deserialize;

use super::{CategoryId, Media, MediaFilter, MediaId};

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DashboardQuery {
    pub liked: bool,
    pub category_id: Option<CategoryId>,
    pub media_type: MediaFilter,
}

impl DashboardQuery {
    pub fn query_string(&self) -> String {
        let mut pairs = url::form_urlencoded::Serializer::new(String::new());
        pairs.append_pair("view", if self.liked { "liked" } else { "all" });
        if let Some(category_id) = self.category_id {
            pairs.append_pair("category_id", &category_id.to_string());
        }
        if self.media_type != MediaFilter::All {
            pairs.append_pair("type", self.media_type.as_query());
        }
        pairs.finish()
    }
}

#[derive(Debug, Clone, Default, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DashboardSummary {
    #[serde(default)]
    pub featured_id: Option<MediaId>,
    #[serde(default)]
    pub quick_access_ids: Vec<MediaId>,
    #[serde(default)]
    pub media: Vec<Media>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn query_uses_web_dashboard_filter_names() {
        let query = DashboardQuery {
            liked: true,
            category_id: Some(CategoryId::new(7)),
            media_type: MediaFilter::Audio,
        };
        assert_eq!(query.query_string(), "view=liked&category_id=7&type=audio");
    }

    #[test]
    fn summary_ignores_additive_fields() {
        let summary: DashboardSummary = serde_json::from_value(serde_json::json!({
            "featuredId": 9,
            "quickAccessIds": [9, 10],
            "media": [{"id": 9, "title": "Signal", "futureField": true}],
            "futureField": {"anything": true}
        }))
        .unwrap();
        assert_eq!(summary.featured_id, Some(MediaId::new(9)));
        assert_eq!(
            summary.quick_access_ids,
            vec![MediaId::new(9), MediaId::new(10)]
        );
        assert_eq!(summary.media[0].title(), "Signal");
    }
}
