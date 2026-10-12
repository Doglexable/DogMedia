use crate::store::ColorScheme;

pub(super) async fn read() -> Option<ColorScheme> {
    // GNOME's own setting is authoritative for a GNOME session. The portal
    // may lag behind it or return "no preference" while GNOME uses light.
    if let Some(scheme) = tokio::task::spawn_blocking(read_gsettings_scheme)
        .await
        .ok()
        .flatten()
    {
        return Some(scheme);
    }
    if let Ok(Some(scheme)) =
        tokio::time::timeout(std::time::Duration::from_secs(2), read_portal_scheme()).await
    {
        return Some(scheme);
    }
    None
}

async fn read_portal_scheme() -> Option<ColorScheme> {
    use zbus::zvariant::OwnedValue;

    let connection = zbus::Connection::session().await.ok()?;
    let call = |method| {
        connection.call_method(
            Some("org.freedesktop.portal.Desktop"),
            "/org/freedesktop/portal/desktop",
            Some("org.freedesktop.portal.Settings"),
            method,
            &("org.freedesktop.appearance", "color-scheme"),
        )
    };
    let reply = match call("ReadOne").await {
        Ok(reply) => reply,
        Err(_) => call("Read").await.ok()?,
    };
    let (value,): (OwnedValue,) = reply.body().deserialize().ok()?;
    portal_value(value)
}

fn portal_value(value: zbus::zvariant::OwnedValue) -> Option<ColorScheme> {
    portal_preference(zbus::zvariant::Value::from(value).downcast::<u32>().ok()?)
}

fn portal_preference(value: u32) -> Option<ColorScheme> {
    match value {
        1 => Some(ColorScheme::Dark),
        2 => Some(ColorScheme::Light),
        _ => None,
    }
}

pub(super) fn read_gsettings_scheme() -> Option<ColorScheme> {
    use std::process::Command;

    let desktop = std::env::var("XDG_CURRENT_DESKTOP").unwrap_or_default();
    if !desktop.split(':').any(|name| {
        name.eq_ignore_ascii_case("GNOME") || name.to_ascii_uppercase().starts_with("GNOME-")
    }) {
        return None;
    }
    let output = Command::new("gsettings")
        .args(["get", "org.gnome.desktop.interface", "color-scheme"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    parse_gsettings_scheme(std::str::from_utf8(&output.stdout).ok()?)
}

fn parse_gsettings_scheme(value: &str) -> Option<ColorScheme> {
    match value.trim().trim_matches('\'') {
        "prefer-dark" => Some(ColorScheme::Dark),
        "prefer-light" | "default" => Some(ColorScheme::Light),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn portal_and_gsettings_preferences_map_to_app_themes() {
        use zbus::zvariant::{OwnedValue, Value};

        assert_eq!(portal_preference(1), Some(ColorScheme::Dark));
        assert_eq!(portal_preference(2), Some(ColorScheme::Light));
        assert_eq!(portal_preference(0), None);
        assert_eq!(
            portal_value(OwnedValue::try_from(Value::U32(1)).unwrap()),
            Some(ColorScheme::Dark)
        );
        assert_eq!(
            portal_value(OwnedValue::try_from(Value::Value(Box::new(Value::U32(2)))).unwrap()),
            Some(ColorScheme::Light)
        );
        assert_eq!(
            parse_gsettings_scheme("'prefer-dark'\n"),
            Some(ColorScheme::Dark)
        );
        assert_eq!(
            parse_gsettings_scheme("'prefer-light'\n"),
            Some(ColorScheme::Light)
        );
        assert_eq!(
            parse_gsettings_scheme("'default'\n"),
            Some(ColorScheme::Light)
        );
    }
}
