use std::collections::HashSet;

use crate::domain::{BrowsePage, BrowseQuery, Cursor, Limit, Media, MediaId};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AccessView {
    FirstRun,
    Checking,
    Ready,
    Denied,
    Unreachable(String),
}

#[derive(Debug, Clone)]
pub struct AppState {
    pub access: AccessView,
    pub query: BrowseQuery,
    pub items: Vec<Media>,
    pub next_cursor: Option<Cursor>,
    pub loading: bool,
    generation: u64,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            access: AccessView::FirstRun,
            query: BrowseQuery {
                limit: Limit::new(50),
                ..BrowseQuery::default()
            },
            items: Vec::new(),
            next_cursor: None,
            loading: false,
            generation: 0,
        }
    }
}

impl AppState {
    pub fn begin_query(&mut self, mut query: BrowseQuery) -> u64 {
        self.generation += 1;
        query.cursor = None;
        self.query = query;
        self.items.clear();
        self.next_cursor = None;
        self.loading = true;
        self.generation
    }

    pub fn next_page(&mut self) -> Option<(u64, BrowseQuery)> {
        if self.loading {
            return None;
        }
        let cursor = self.next_cursor.clone()?;
        self.loading = true;
        let mut query = self.query.clone();
        query.cursor = Some(cursor);
        Some((self.generation, query))
    }

    pub fn apply_page(&mut self, generation: u64, page: BrowsePage, append: bool) -> bool {
        if generation != self.generation {
            return false;
        }
        let mut ids: HashSet<MediaId> = if append {
            self.items.iter().map(|item| item.id).collect()
        } else {
            self.items.clear();
            HashSet::new()
        };
        self.items
            .extend(page.items.into_iter().filter(|item| ids.insert(item.id)));
        self.next_cursor = page.next_cursor;
        self.loading = false;
        true
    }

    pub fn fail(&mut self, generation: u64) -> bool {
        if generation != self.generation {
            return false;
        }
        self.loading = false;
        true
    }

    pub fn generation(&self) -> u64 {
        self.generation
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn media(id: MediaId) -> Media {
        Media {
            id,
            title: None,
            artists: None,
            description: None,
            duration: None,
            mime_type: None,
            category_id: None,
            category_name: None,
            category_path: None,
            artwork_version: None,
            liked: false,
            source_version: None,
        }
    }

    #[test]
    fn stale_browse_response_is_rejected_and_pages_are_deduplicated() {
        let mut state = AppState::default();
        let old = state.begin_query(BrowseQuery::default());
        let current = state.begin_query(BrowseQuery {
            search: "new".into(),
            ..BrowseQuery::default()
        });
        assert!(!state.apply_page(
            old,
            BrowsePage {
                items: vec![media(MediaId::new(1))],
                next_cursor: None
            },
            false
        ));
        assert!(state.apply_page(
            current,
            BrowsePage {
                items: vec![media(MediaId::new(1)), media(MediaId::new(1))],
                next_cursor: Some("next".into())
            },
            false
        ));
        assert_eq!(state.items.len(), 1);
        let (_, query) = state.next_page().unwrap();
        assert_eq!(query.cursor.as_ref().map(Cursor::as_str), Some("next"));
    }
}
