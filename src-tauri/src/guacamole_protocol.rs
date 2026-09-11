//! Minimal Guacamole protocol parser/encoder (guacamole-lite compatible).

/// Encode elements as a Guacamole instruction string.
pub fn to_instruction(elements: &[impl AsRef<str>]) -> String {
    if elements.is_empty() {
        return String::new();
    }

    let mut out = String::new();
    for (i, el) in elements.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        let s = el.as_ref();
        let len = s.len();
        out.push_str(&format!("{len}.{s}"));
    }
    out.push(';');
    out
}

/// Parse one or more complete instructions from a text chunk.
#[allow(dead_code)]
pub fn parse_instructions(data: &str) -> Vec<(String, Vec<String>)> {
    let mut out = Vec::new();
    for segment in data.split(';').filter(|s| !s.is_empty()) {
        if let Some((opcode, params)) = parse_instruction_segment(segment) {
            out.push((opcode, params));
        }
    }
    out
}

fn parse_instruction_segment(segment: &str) -> Option<(String, Vec<String>)> {
    let bytes = segment.as_bytes();
    let mut offset = 0;
    let mut elements = Vec::new();

    while offset < bytes.len() {
        let dot_rel = bytes[offset..].iter().position(|&b| b == b'.')?;
        let dot = offset + dot_rel;
        let len: usize = std::str::from_utf8(&bytes[offset..dot])
            .ok()?
            .parse()
            .ok()?;
        let value_start = dot + 1;
        let value_end = value_start + len;
        if value_end > bytes.len() {
            return None;
        }
        let value = std::str::from_utf8(&bytes[value_start..value_end])
            .ok()?
            .to_string();
        elements.push(value);
        offset = value_end;
        if offset < bytes.len() {
            if bytes[offset] != b',' {
                return None;
            }
            offset += 1;
        }
    }

    if elements.is_empty() {
        return None;
    }

    let opcode = elements.remove(0);
    Some((opcode, elements))
}

/// Streaming parser for Guacamole text instructions.
#[derive(Default)]
pub struct Parser {
    buffer: String,
}

impl Parser {
    pub fn receive(&mut self, packet: &str) -> Vec<(String, Vec<String>)> {
        self.buffer.push_str(packet);
        let mut instructions = Vec::new();

        while let Some(semi) = self.buffer.find(';') {
            let segment = self.buffer[..semi].to_string();
            self.buffer = self.buffer[semi + 1..].to_string();
            if let Some(ins) = parse_instruction_segment(&segment) {
                instructions.push(ins);
            }
        }

        instructions
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_select_instruction() {
        assert_eq!(to_instruction(&["select", "rdp"]), "6.select,3.rdp;");
    }

    #[test]
    fn parses_args_instruction() {
        let ins = parse_instructions("4.args,8.hostname,8.password;");
        assert_eq!(ins.len(), 1);
        assert_eq!(ins[0].0, "args");
        assert_eq!(ins[0].1, vec!["hostname", "password"]);
    }

    #[test]
    fn parser_streams_complete_instructions() {
        let mut p = Parser::default();
        let ins = p.receive("4.args,8.hostname,8.password;");
        assert_eq!(ins.len(), 1);
        assert_eq!(ins[0].0, "args");
    }
}
