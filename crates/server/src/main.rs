// Entry point: parse `--repo <path> [--port <port>]`, verify `git` is on
// PATH (push/pull/revert/list_worktrees shell out to it — see git-core's
// `run_git`), then serve `server::router`.

fn parse_args() -> Result<(String, u16), String> {
    let mut repo: Option<String> = None;
    let mut port: u16 = 4420;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--repo" => repo = Some(args.next().ok_or("--repo requires a value")?),
            "--port" => {
                let value = args.next().ok_or("--port requires a value")?;
                port = value
                    .parse()
                    .map_err(|_| format!("invalid --port value: {value}"))?;
            }
            other => return Err(format!("unknown argument: {other}")),
        }
    }
    let repo = repo.ok_or("missing required --repo <path>")?;
    Ok((repo, port))
}

#[tokio::main]
async fn main() {
    let (repo, port) = parse_args().unwrap_or_else(|e| {
        eprintln!("error: {e}\nusage: diff-viewer-server --repo <path> [--port <port>]");
        std::process::exit(1);
    });

    let repo_path = std::fs::canonicalize(&repo).unwrap_or_else(|e| {
        eprintln!("error: cannot resolve --repo path {repo:?}: {e}");
        std::process::exit(1);
    });
    let repo_path = repo_path.to_string_lossy().into_owned();

    if let Err(e) = std::process::Command::new("git").arg("--version").output() {
        eprintln!(
            "error: `git` was not found on PATH ({e}) — push/pull/revert/list_worktrees need it"
        );
        std::process::exit(1);
    }

    let state = server::AppState {
        repo_path,
        write_lock: tokio::sync::Mutex::new(()),
    };
    let app = server::router(state);

    let addr = format!("0.0.0.0:{port}");
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap_or_else(|e| {
        eprintln!("error: cannot bind {addr}: {e}");
        std::process::exit(1);
    });
    println!("diff-viewer-server listening on http://{addr}");
    axum::serve(listener, app).await.expect("server error");
}
