fn main() {
    eprintln!("dogmedia-desktop pid={}", std::process::id());
    let arguments: Vec<String> = std::env::args().collect();
    if arguments
        .iter()
        .any(|argument| argument == "--memory-snapshot")
    {
        match dogmedia_desktop::diagnostics::process_memory_snapshot() {
            Ok(snapshot) => println!("{snapshot}"),
            Err(error) => eprintln!("memory snapshot unavailable: {error}"),
        }
        return;
    }
    let memory_watch = arguments
        .iter()
        .any(|argument| argument == "--memory-watch" || argument.starts_with("--memory-watch="));
    if memory_watch {
        let interval_secs = arguments
            .iter()
            .position(|arg| arg == "--memory-watch")
            .and_then(|idx| arguments.get(idx + 1))
            .and_then(|val| val.parse::<u64>().ok())
            .or_else(|| {
                arguments
                    .iter()
                    .find_map(|arg| arg.strip_prefix("--memory-watch=")?.parse::<u64>().ok())
            })
            .unwrap_or(60);

        std::thread::spawn(move || {
            match dogmedia_desktop::diagnostics::process_memory_snapshot() {
                Ok(snapshot) => eprintln!("memory {snapshot}"),
                Err(error) => eprintln!("memory snapshot unavailable: {error}"),
            }
            loop {
                std::thread::sleep(std::time::Duration::from_secs(interval_secs));
                match dogmedia_desktop::diagnostics::process_memory_snapshot() {
                    Ok(snapshot) => eprintln!("memory {snapshot}"),
                    Err(error) => eprintln!("memory snapshot unavailable: {error}"),
                }
            }
        });
    }
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
