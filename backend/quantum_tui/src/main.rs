use crossterm::{
    event::{self, DisableMouseCapture, EnableMouseCapture, Event, KeyCode},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::{
    backend::CrosstermBackend,
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Gauge, List, ListItem, Paragraph, Sparkline, Wrap},
    Frame, Terminal,
};
use std::{error::Error, io, sync::Arc, time::Duration};
use tokio::sync::mpsc;

#[derive(Clone, Debug)]
pub struct CccTelemetryFrame {
    pub raw_bytes: Vec<u8>,
    pub encrypted_bytes: Vec<u8>,
    pub entropy_bits: f64,
    pub latency_ms: u64,
    pub consensus_quorum: u16,
    pub active_peers: usize,
    pub log_message: String,
}

pub struct CccDashboardState {
    pub raw_view: String,
    pub quantum_view: String,
    pub entropy_score: f64,
    pub latency_history: Vec<u64>,
    pub quorum_percentage: u16,
    pub peer_count: usize,
    pub event_logs: Vec<String>,
}

impl Default for CccDashboardState {
    fn default() -> Self {
        Self {
            raw_view: "POST /v1/clearing HTTP/1.1\r\nHost: bank.internal\r\nAmount: £1,500,000 GBP"
                .to_string(),
            quantum_view: "4f8a92b1c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0"
                .to_string(),
            entropy_score: 7.9994,
            latency_history: vec![10, 12, 9, 11, 14, 10, 8, 12, 11, 9, 10, 11],
            quorum_percentage: 100,
            peer_count: 8,
            event_logs: vec![
                "[SYSTEM] CCC Operational Control Center Active".to_string(),
                "[CRYPTO] FIPS 203 (ML-KEM-1024) Key Pair Instantiated".to_string(),
                "[CONSENSUS] Quorum threshold verified: 2/3+1 nodes aligned".to_string(),
            ],
        }
    }
}

impl CccDashboardState {
    pub fn ingest_telemetry(&mut self, frame: CccTelemetryFrame) {
        self.raw_view = String::from_utf8_lossy(&frame.raw_bytes).to_string();
        self.quantum_view = hex::encode(&frame.encrypted_bytes);
        self.entropy_score = frame.entropy_bits;
        self.quorum_percentage = frame.consensus_quorum;
        self.peer_count = frame.active_peers;

        self.latency_history.remove(0);
        self.latency_history.push(frame.latency_ms);

        self.event_logs.push(frame.log_message);
        if self.event_logs.len() > 8 {
            self.event_logs.remove(0);
        }
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    // Enable raw terminal mode
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen, EnableMouseCapture)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    let (tx, mut rx) = mpsc::channel::<CccTelemetryFrame>(100);

    // Spawn background telemetry generator simulating live mesh activity
    tokio::spawn(async move {
        let mut count = 0u64;
        loop {
            tokio::time::sleep(Duration::from_millis(400)).await;
            count += 1;
            let mock_frame = CccTelemetryFrame {
                raw_bytes: format!("SETTLEMENT_PAYLOAD_ID_{:05}_AMOUNT_£1.5M_GBP", count)
                    .into_bytes(),
                encrypted_bytes: (0..48).map(|_| rand_byte()).collect(),
                entropy_bits: 7.9980 + ((count % 15) as f64 * 0.0001),
                latency_ms: 8 + (count % 7),
                consensus_quorum: 100,
                active_peers: 12,
                log_message: format!("[GOSSIP] Block #{} verified via ML-DSA-87 signature", count),
            };
            if tx.send(mock_frame).await.is_err() {
                break;
            }
        }
    });

    let mut state = CccDashboardState::default();

    loop {
        // Process telemetry queue
        while let Ok(frame) = rx.try_recv() {
            state.ingest_telemetry(frame);
        }

        terminal.draw(|f| render_ccc_ui(f, &state))?;

        if event::poll(Duration::from_millis(50))? {
            if let Event::Key(key) = event::read()? {
                if let KeyCode::Char('q') = key.code {
                    break;
                }
            }
        }
    }

    // Restore terminal state
    disable_raw_mode()?;
    execute!(
        terminal.backend_mut(),
        LeaveAlternateScreen,
        DisableMouseCapture
    )?;
    terminal.show_cursor()?;

    Ok(())
}

fn rand_byte() -> u8 {
    (std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .subsec_nanos()
        % 255) as u8
}

fn render_ccc_ui(f: &mut Frame, state: &CccDashboardState) {
    let main_layout = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3), // Banner Header
            Constraint::Min(12),   // Split-Screen Ingress Monitor
            Constraint::Length(5), // Real-Time Metrics Gauges
            Constraint::Length(6), // Event Logs & Audit Stream
        ])
        .split(f.size());

    // --- Header ---
    let header_text = format!(
        " VARDHAN TECHNOLOGIES :: COMMAND CONTROL CENTER (CCC) | ACTIVE PEERS: {} ",
        state.peer_count
    );
    let header = Paragraph::new(header_text)
        .style(
            Style::default()
                .fg(Color::Cyan)
                .add_modifier(Modifier::BOLD),
        )
        .block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::DarkGray)),
        );
    f.render_widget(header, main_layout[0]);

    // --- Split-Screen Payload Monitor ---
    let split_layout = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(50), Constraint::Percentage(50)])
        .split(main_layout[1]);

    // Side A: Plaintext Wireshark Leakage
    let side_a = Paragraph::new(state.raw_view.as_str())
        .style(Style::default().fg(Color::LightRed))
        .block(
            Block::default()
                .title(" [SIDE A] Legacy Ingress Plaintext Leakage (Wireshark Target) ")
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::Red)),
        )
        .wrap(Wrap { trim: false });
    f.render_widget(side_a, split_layout[0]);

    // Side B: Post-Quantum Encapsulated Stream
    let side_b = Paragraph::new(state.quantum_view.as_str())
        .style(Style::default().fg(Color::LightGreen))
        .block(
            Block::default()
                .title(" [SIDE B] FIPS 203 / 204 Post-Quantum Encapsulated Stream ")
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::Green)),
        )
        .wrap(Wrap { trim: false });
    f.render_widget(side_b, split_layout[1]);

    // --- Metrics & Telemetry Gauges ---
    let metrics_layout = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Percentage(33),
            Constraint::Percentage(33),
            Constraint::Percentage(34),
        ])
        .split(main_layout[2]);

    // Consensus Quorum Gauge
    let quorum_gauge = Gauge::default()
        .block(
            Block::default()
                .title(" ML-DSA Quorum Finality ")
                .borders(Borders::ALL),
        )
        .gauge_style(Style::default().fg(Color::Green))
        .percent(state.quorum_percentage);
    f.render_widget(quorum_gauge, metrics_layout[0]);

    // Shannon Entropy Display
    let entropy_str = format!(
        " Entropy Score: {:.4} / 8.0000\n Shield State: HNDL Impervious",
        state.entropy_score
    );
    let entropy_panel = Paragraph::new(entropy_str).block(
        Block::default()
            .title(" HNDL Shannon Entropy ")
            .borders(Borders::ALL),
    );
    f.render_widget(entropy_panel, metrics_layout[1]);

    // Handshake Latency Sparkline
    let latency_sparkline = Sparkline::default()
        .block(
            Block::default()
                .title(" Latency Sparkline (ms) ")
                .borders(Borders::ALL),
        )
        .data(&state.latency_history)
        .style(Style::default().fg(Color::Yellow));
    f.render_widget(latency_sparkline, metrics_layout[2]);

    // --- Event Audit Log Stream ---
    let logs: Vec<ListItem> = state
        .event_logs
        .iter()
        .map(|log| ListItem::new(Span::styled(log, Style::default().fg(Color::Gray))))
        .collect();
    let log_list = List::new(logs).block(
        Block::default()
            .title(" Live System Event Stream ")
            .borders(Borders::ALL),
    );
    f.render_widget(log_list, main_layout[3]);
}
