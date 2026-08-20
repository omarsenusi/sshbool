//! SSE transport stream handler for MCP clients.

use axum::response::sse::{Event, KeepAlive, Sse};
use futures::stream::{self, Stream, StreamExt};
use std::convert::Infallible;
use std::time::Duration;

/// Returns an SSE stream emitting initial endpoint notification and keep-alive pings.
pub fn create_sse_stream(
    post_endpoint_url: String,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let initial_event = Event::default()
        .event("endpoint")
        .data(post_endpoint_url);

    let stream = stream::once(async move { Ok(initial_event) }).chain(stream::pending());

    Sse::new(stream).keep_alive(KeepAlive::new().interval(Duration::from_secs(15)))
}

