// Tauri application entry. Local-git commands live in `git.rs`.

mod git;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            git::open_repo,
            git::repo_root,
            git::list_commits,
            git::list_changes,
            git::read_file,
            git::apply_hunk,
            git::stage_paths,
            git::unstage_paths,
            git::discard_paths,
            git::commit,
            git::push,
            git::pull,
            git::revert_commit,
            git::list_branches,
            git::list_tags,
            git::list_worktrees
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
