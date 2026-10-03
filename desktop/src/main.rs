fn main() {
    // Winit's Wayland backend can receive a queued event immediately after its
    // calloop source has been removed. Calloop safely discards that stale event,
    // but logs it at WARN. Keep real warnings visible and silence only this
    // known-benign event-loop target.
    let filter = tracing_subscriber::EnvFilter::from_default_env().add_directive(
        "calloop::loop_logic=error"
            .parse()
            .expect("valid calloop tracing directive"),
    );
    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .without_time()
        .init();
    dogmedia_desktop::ui::run();
}
