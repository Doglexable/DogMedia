use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Serialize};

macro_rules! int_id {
    ($name:ident) => {
        #[derive(
            Debug,
            Clone,
            Copy,
            Default,
            PartialEq,
            Eq,
            Hash,
            PartialOrd,
            Ord,
            Serialize,
            Deserialize,
        )]
        #[serde(transparent)]
        pub struct $name(i64);

        impl $name {
            pub const fn new(value: i64) -> Self {
                Self(value)
            }

            pub const fn get(self) -> i64 {
                self.0
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                self.0.fmt(formatter)
            }
        }

        impl From<i64> for $name {
            fn from(value: i64) -> Self {
                Self(value)
            }
        }

        impl From<$name> for i64 {
            fn from(value: $name) -> Self {
                value.0
            }
        }

        impl FromStr for $name {
            type Err = std::num::ParseIntError;

            fn from_str(value: &str) -> Result<Self, Self::Err> {
                value.parse::<i64>().map(Self)
            }
        }
    };
}

int_id!(MediaId);
int_id!(CategoryId);
int_id!(SubtitleId);

macro_rules! string_id {
    ($name:ident) => {
        #[derive(Debug, Clone, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
        #[serde(transparent)]
        pub struct $name(String);

        impl $name {
            pub fn new(value: impl Into<String>) -> Self {
                Self(value.into())
            }

            pub fn as_str(&self) -> &str {
                &self.0
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                self.0.fmt(formatter)
            }
        }

        impl From<&str> for $name {
            fn from(value: &str) -> Self {
                Self(value.to_owned())
            }
        }

        impl From<String> for $name {
            fn from(value: String) -> Self {
                Self(value)
            }
        }
    };
}

string_id!(SessionId);
string_id!(ViewerId);

/// Server-relative media path (e.g. `/api/media/4/stream?quality=high`).
/// Only ever constructed from a server response or a validated [`Endpoint`];
/// resolved against the server origin before use.
#[derive(Debug, Clone, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct StreamPath(String);

impl StreamPath {
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for StreamPath {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

impl From<&str> for StreamPath {
    fn from(value: &str) -> Self {
        Self(value.to_owned())
    }
}

impl From<String> for StreamPath {
    fn from(value: String) -> Self {
        Self(value)
    }
}

/// Opaque pagination cursor handed out by the server. Never constructed locally
/// from anything but a previous server response.
#[derive(Debug, Clone, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Cursor(String);

impl Cursor {
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for Cursor {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

impl From<&str> for Cursor {
    fn from(value: &str) -> Self {
        Self(value.to_owned())
    }
}

impl From<String> for Cursor {
    fn from(value: String) -> Self {
        Self(value)
    }
}

/// Browse page size, always clamped to the server-accepted `1..=100` range.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Limit(u8);

impl Default for Limit {
    fn default() -> Self {
        Self::DEFAULT
    }
}

impl Limit {
    pub const DEFAULT: Self = Self(50);

    pub fn new(value: u8) -> Self {
        Self(value.clamp(1, 100))
    }

    pub const fn get(self) -> u8 {
        self.0
    }
}

impl fmt::Display for Limit {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

impl From<u8> for Limit {
    fn from(value: u8) -> Self {
        Self::new(value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn limit_clamps_to_server_range() {
        assert_eq!(Limit::new(0).get(), 1);
        assert_eq!(Limit::new(50).get(), 50);
        assert_eq!(Limit::new(255).get(), 100);
    }

    #[test]
    fn ids_serialize_as_their_primitive_wire_form() {
        assert_eq!(serde_json::to_string(&MediaId::new(9)).unwrap(), "9");
        assert_eq!(
            serde_json::from_str::<CategoryId>("7").unwrap(),
            CategoryId::new(7)
        );
        assert_eq!(
            serde_json::to_string(&ViewerId::from("viewer-1")).unwrap(),
            "\"viewer-1\""
        );
    }
}
