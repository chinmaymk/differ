// Tauri application entry. Local-git commands live in `git.rs`.

mod git;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            git::open_repo,
            git::repo_root,
            git::list_changes,
            git::read_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
