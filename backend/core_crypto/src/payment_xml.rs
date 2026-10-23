//! Bounded XML parsing for the experimental single-payment profile.
//! This is structural validation, not ISO XSD or market-practice validation.
use crate::iso20022_pqc::Iso20022Error;
use roxmltree::{Document, Node, ParsingOptions};

pub(crate) const SEAL_NS: &str = "urn:vardhan:qcore:pqc:2";
pub const MAX_XML_BYTES: usize = 1_048_576;
const MAX_XML_NODES: u32 = 20_000;
const MAX_XML_DEPTH: usize = 64;

pub(crate) fn invalid(message: &str) -> Iso20022Error {
    Iso20022Error::SchemaValidationFailed(message.into())
}

pub(crate) fn parse(xml: &str) -> Result<Document<'_>, Iso20022Error> {
    if xml.len() > MAX_XML_BYTES {
        return Err(invalid("XML document exceeds size limit"));
    }
    // A Rust string is UTF-8; accepting a different declaration creates divergent
    // interpretations when the same document is handed to a byte-oriented parser.
    let mut reader = quick_xml::Reader::from_str(xml);
    if let quick_xml::events::Event::Decl(declaration) = reader
        .read_event()
        .map_err(|_| invalid("Invalid XML declaration"))?
    {
        if declaration
            .version()
            .map_err(|_| invalid("Missing XML version"))?
            .as_ref()
            != b"1.0"
        {
            return Err(invalid("Only XML 1.0 is supported"));
        }
        if let Some(encoding) = declaration.encoding() {
            if !encoding
                .map_err(|_| invalid("Invalid XML encoding"))?
                .eq_ignore_ascii_case(b"UTF-8")
            {
                return Err(invalid("Only UTF-8 XML is supported"));
            }
        }
    }
    let doc = Document::parse_with_options(
        xml,
        ParsingOptions {
            allow_dtd: false,
            nodes_limit: MAX_XML_NODES,
            ..ParsingOptions::default()
        },
    )
    .map_err(|_| Iso20022Error::MalformedXml("Invalid XML (DTD/entities are forbidden)".into()))?;
    if doc
        .descendants()
        .any(|n| n.ancestors().take(MAX_XML_DEPTH + 2).count() > MAX_XML_DEPTH)
    {
        return Err(invalid("XML nesting exceeds limit"));
    }
    // Comments and processing instructions are excluded from this profile to avoid
    // alternate parser interpretations of security-sensitive content.
    if doc.descendants().any(|n| n.is_comment() || n.is_pi()) {
        return Err(invalid(
            "Comments and processing instructions are unsupported",
        ));
    }
    let root = doc.root_element();
    if root.tag_name().name() != "Document" {
        return Err(invalid("Expected Document root"));
    }
    let (namespace, message_name) = match root.tag_name().namespace() {
        Some("urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08") => {
            (root.tag_name().namespace().unwrap(), "FIToFICstmrCdtTrf")
        }
        Some("urn:iso:std:iso:20022:tech:xsd:pacs.009.001.08") => {
            (root.tag_name().namespace().unwrap(), "FICdtTrf")
        }
        _ => return Err(invalid("Unsupported ISO message namespace/version")),
    };
    let children: Vec<_> = root.children().filter(Node::is_element).collect();
    if children.len() != 1 || !children[0].has_tag_name((namespace, message_name)) {
        return Err(invalid(
            "Expected exactly one matching payment message root",
        ));
    }
    let message = children[0];
    let group = child(message, "GrpHdr")?;
    let transaction = child(message, "CdtTrfTxInf")?;
    let mut seals = 0;
    for node in root.descendants().filter(Node::is_element) {
        let name = node.tag_name().name();
        if name == "VardhanPqcSeal" {
            seals += 1;
            if node.tag_name().namespace() != Some(SEAL_NS) || seals > 1 {
                return Err(invalid("Invalid or duplicate PQC seal"));
            }
        } else if node.tag_name().namespace() != Some(namespace) {
            return Err(invalid("Foreign namespace in payment body"));
        }
        if matches!(name, "Document" | "FIToFICstmrCdtTrf" | "FICdtTrf")
            && node != root
            && node != message
        {
            return Err(invalid("Nested document/message root"));
        }
        if (name == "GrpHdr" && node != group) || (name == "CdtTrfTxInf" && node != transaction) {
            return Err(invalid("Duplicate/nested payment body"));
        }
        if name == "SplmtryData" {
            if node.parent() != Some(message) {
                return Err(invalid("Unexpected supplementary data location"));
            }
            let place = child(node, "PlcAndNm")?;
            if text(place)? != "VARDHAN-QCORE-PQC-SEAL-V2" {
                return Err(invalid("Unsupported supplementary data profile"));
            }
            let env = child(node, "Envlp")?;
            let elements: Vec<_> = env.children().filter(Node::is_element).collect();
            if elements.len() != 1
                || !elements[0].has_tag_name((SEAL_NS, "VardhanPqcSeal"))
                || node.children().filter(Node::is_element).count() != 2
            {
                return Err(invalid("Invalid seal envelope structure"));
            }
            text(elements[0])?;
        }
    }
    if message
        .children()
        .filter(|n| n.is_element() && n.tag_name().name() == "SplmtryData")
        .count()
        != seals
    {
        return Err(invalid(
            "Seal must occur in exactly one supplementary envelope",
        ));
    }
    Ok(doc)
}

pub(crate) fn message<'a, 'input>(doc: &'a Document<'input>) -> Node<'a, 'input> {
    doc.root_element()
        .children()
        .find(Node::is_element)
        .expect("validated message")
}

pub(crate) fn message_type<'a>(doc: &'a Document<'_>) -> &'a str {
    doc.root_element()
        .tag_name()
        .namespace()
        .expect("validated namespace")
        .strip_prefix("urn:iso:std:iso:20022:tech:xsd:")
        .expect("validated namespace prefix")
}

pub(crate) fn child<'a, 'input>(
    node: Node<'a, 'input>,
    name: &str,
) -> Result<Node<'a, 'input>, Iso20022Error> {
    let mut children = node.children().filter(|n| {
        n.is_element()
            && n.tag_name().name() == name
            && n.tag_name().namespace() == node.tag_name().namespace()
    });
    let found = children
        .next()
        .ok_or_else(|| invalid("Missing required payment field"))?;
    if children.next().is_some() {
        return Err(invalid("Duplicate payment field"));
    }
    Ok(found)
}

pub(crate) fn path<'a, 'input>(
    mut node: Node<'a, 'input>,
    names: &[&str],
) -> Result<Node<'a, 'input>, Iso20022Error> {
    for name in names {
        node = child(node, name)?;
    }
    Ok(node)
}

pub(crate) fn text(node: Node<'_, '_>) -> Result<String, Iso20022Error> {
    if node.children().any(|n| n.is_element()) {
        return Err(invalid("Expected text-only field"));
    }
    let text: String = node.children().filter_map(|n| n.text()).collect();
    if text.trim().is_empty() {
        return Err(invalid("Empty payment field"));
    }
    Ok(text.trim().to_owned())
}

// Versioned application representation: expanded names, sorted expanded attributes,
// ordered children, exact decoded character data. This is NOT W3C XML C14N.
fn representation(node: Node<'_, '_>) -> serde_json::Value {
    if node.is_text() {
        return serde_json::json!(["text", node.text().unwrap_or("")]);
    }
    let mut attrs: Vec<_> = node
        .attributes()
        .map(|a| (a.namespace().unwrap_or(""), a.name(), a.value()))
        .collect();
    attrs.sort_unstable();
    let children: Vec<_> = node
        .children()
        .filter(|n| n.is_text() || n.is_element())
        .filter(|n| !(n.is_element() && n.tag_name().name() == "SplmtryData"))
        .map(representation)
        .collect();
    serde_json::json!([
        "element",
        node.tag_name().namespace().unwrap_or(""),
        node.tag_name().name(),
        attrs,
        children
    ])
}

pub(crate) fn canonical(doc: &Document<'_>) -> String {
    representation(doc.root_element()).to_string()
}

pub(crate) fn seal_json(doc: &Document<'_>) -> Result<String, Iso20022Error> {
    let node = doc
        .descendants()
        .find(|n| n.has_tag_name((SEAL_NS, "VardhanPqcSeal")))
        .ok_or(Iso20022Error::MissingPqcSeal)?;
    text(node)
}

pub(crate) fn embed(xml: &str, seal: &str) -> Result<String, Iso20022Error> {
    use quick_xml::{
        events::{BytesStart, BytesText, Event},
        Reader, Writer,
    };
    let doc = parse(xml)?;
    if doc
        .descendants()
        .any(|n| n.has_tag_name((SEAL_NS, "VardhanPqcSeal")))
    {
        return Err(invalid("Document already contains a seal"));
    }
    let namespace = doc.root_element().tag_name().namespace().unwrap();
    let mut reader = Reader::from_str(xml);
    let mut writer = Writer::new(Vec::new());
    let mut depth = 0;
    let io_error = |_| invalid("XML serialization failed");
    loop {
        let event = reader
            .read_event()
            .map_err(|_| invalid("Invalid XML event"))?;
        match &event {
            Event::Start(_) => depth += 1,
            Event::End(_) => {
                if depth == 2 {
                    let mut supplementary = BytesStart::new("SplmtryData");
                    supplementary.push_attribute(("xmlns", namespace));
                    writer
                        .write_event(Event::Start(supplementary))
                        .map_err(io_error)?;
                    writer
                        .create_element("PlcAndNm")
                        .write_text_content(BytesText::new("VARDHAN-QCORE-PQC-SEAL-V2"))
                        .map_err(io_error)?;
                    writer
                        .write_event(Event::Start(BytesStart::new("Envlp")))
                        .map_err(io_error)?;
                    writer
                        .create_element("VardhanPqcSeal")
                        .with_attribute(("xmlns", SEAL_NS))
                        .write_text_content(BytesText::new(seal))
                        .map_err(io_error)?;
                    writer
                        .write_event(Event::End(quick_xml::events::BytesEnd::new("Envlp")))
                        .map_err(io_error)?;
                    writer
                        .write_event(Event::End(quick_xml::events::BytesEnd::new("SplmtryData")))
                        .map_err(io_error)?;
                }
                depth -= 1;
            }
            Event::Eof => break,
            _ => {}
        }
        writer.write_event(event).map_err(io_error)?;
    }
    let result =
        String::from_utf8(writer.into_inner()).map_err(|_| invalid("Invalid UTF-8 output"))?;
    let output = parse(&result)?;
    if canonical(&doc) != canonical(&output) {
        return Err(invalid("Transformation changed payment content"));
    }
    Ok(result)
}
