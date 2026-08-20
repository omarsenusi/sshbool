//! Red-team corpus data-driven test runner.
//! Asserts zero silent allows across all test vectors.

use mcp::policy::risk::classify_command;
use mcp::policy::tier::Tier;
use serde::Deserialize;
use std::fs;
use std::path::Path;

#[derive(Debug, Deserialize)]
struct CorpusItem {
    cmd: String,
    tier: String,
    #[serde(default)]
    rules: Vec<String>,
    note: String,
}

fn parse_expected_tier(s: &str) -> Tier {
    match s {
        "safe" | "informational" => Tier::Safe,
        "write" => Tier::Write,
        "dangerous" => Tier::Dangerous,
        other => panic!("unknown tier in corpus: {other}"),
    }
}

fn run_corpus_file(file_path: &Path) {
    let content = fs::read_to_string(file_path)
        .unwrap_or_else(|e| panic!("failed to read corpus file {}: {}", file_path.display(), e));

    let mut count = 0;
    for (idx, line) in content.lines().enumerate() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with("//") {
            continue;
        }

        let item: CorpusItem = serde_json::from_str(trimmed).unwrap_or_else(|e| {
            panic!(
                "failed to parse line {} in {}: {}",
                idx + 1,
                file_path.display(),
                e
            )
        });

        let expected_tier = parse_expected_tier(&item.tier);
        let _ = &item.rules;
        let result = classify_command(&item.cmd);

        // Assert: computed tier must be >= expected_tier (never lower risk than expected)
        assert!(
            result.tier >= expected_tier,
            "Corpus failure in {} line {} ({:?}): expected at least {:?}, got {:?} for command: `{}`",
            file_path.display(),
            idx + 1,
            item.note,
            expected_tier,
            result.tier,
            item.cmd
        );

        // If tier is write or dangerous, reasons MUST not be empty
        if result.tier > Tier::Safe {
            assert!(
                !result.reasons.is_empty(),
                "Corpus failure in {} line {}: non-safe tier {:?} produced empty reasons for command: `{}`",
                file_path.display(),
                idx + 1,
                result.tier,
                item.cmd
            );
        }

        count += 1;
    }
    println!("Processed {count} corpus items from {}", file_path.display());
}

#[test]
fn test_all_redteam_corpus_files() {
    let corpus_dir = Path::new("tests/corpus");
    assert!(corpus_dir.exists(), "corpus directory missing");

    let entries = fs::read_dir(corpus_dir).unwrap();
    let mut total_files = 0;
    for entry in entries {
        let entry = entry.unwrap();
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) == Some("jsonl") {
            run_corpus_file(&path);
            total_files += 1;
        }
    }
    assert!(total_files > 0, "No corpus .jsonl files were found");
}

#[test]
fn test_classifier_performance_budget() {
    let sample_cmd = "rm -rf /var/lib/app /var/log/syslog /etc/shadow /usr/bin/python3 ".repeat(50);
    assert!(sample_cmd.len() >= 3000);

    // Warm up lazy static regexes
    let _ = classify_command("ls");

    let start = std::time::Instant::now();
    let _res = classify_command(&sample_cmd);
    let elapsed = start.elapsed();

    // Must be under 2 ms in release, 10 ms in unoptimized debug build (08 §11)
    let max_budget_ms = if cfg!(debug_assertions) { 10 } else { 2 };
    assert!(
        elapsed < std::time::Duration::from_millis(max_budget_ms),
        "Classifier took {:?}, exceeding {}ms budget",
        elapsed,
        max_budget_ms
    );
}
