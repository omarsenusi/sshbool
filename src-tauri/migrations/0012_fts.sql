-- 0012_fts.sql
CREATE VIRTUAL TABLE IF NOT EXISTS fts_hosts USING fts5(label, hostname, notes, content='hosts', content_rowid='rowid');
CREATE VIRTUAL TABLE IF NOT EXISTS fts_snippets USING fts5(name, body, content='snippets', content_rowid='rowid');
CREATE VIRTUAL TABLE IF NOT EXISTS fts_notes USING fts5(title, body_md, content='notes', content_rowid='rowid');
CREATE VIRTUAL TABLE IF NOT EXISTS fts_commands USING fts5(command, content='command_history', content_rowid='rowid');
