use axum::Json;
use serde_json::{json, Value};

pub async fn liveness() -> Json<Value> {
    Json(json!({ "status": "ok" }))
}
