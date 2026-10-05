#!/bin/bash
sed -i '' -e 's/use axum::extract::{/use axum::extract::{Extension, /g' backend/pq_shield/src/admin.rs

sed -i '' -e 's/async fn session_info_handler(/async fn session_info_handler(\n    Extension(caller): Extension<auth_service::AuthenticatedUser>,\n    Extension(token): Extension<auth_service::session::SessionToken>,/g' backend/pq_shield/src/admin.rs
sed -i '' -e 's/auth_service::session_info_handler(State(state.auth_state), headers).await/auth_service::session_info_handler(State(state.auth_state), Extension(caller), Extension(token), headers).await/g' backend/pq_shield/src/admin.rs

sed -i '' -e 's/async fn admin_get_profile(/async fn admin_get_profile(\n    Extension(caller): Extension<auth_service::AuthenticatedUser>,/g' backend/pq_shield/src/admin.rs
sed -i '' -e 's/auth_service::get_profile_handler(State(state.auth_state), headers).await/auth_service::get_profile_handler(State(state.auth_state), Extension(caller), headers).await/g' backend/pq_shield/src/admin.rs

sed -i '' -e 's/async fn admin_update_profile(/async fn admin_update_profile(\n    Extension(caller): Extension<auth_service::AuthenticatedUser>,/g' backend/pq_shield/src/admin.rs
sed -i '' -e 's/auth_service::update_profile_handler(State(state.auth_state), headers, Json(req)).await/auth_service::update_profile_handler(State(state.auth_state), Extension(caller), headers, Json(req)).await/g' backend/pq_shield/src/admin.rs

sed -i '' -e 's/async fn admin_change_password(/async fn admin_change_password(\n    Extension(caller): Extension<auth_service::AuthenticatedUser>,/g' backend/pq_shield/src/admin.rs
sed -i '' -e 's/auth_service::change_password_handler(State(state.auth_state), headers, Json(req)).await/auth_service::change_password_handler(State(state.auth_state), Extension(caller), headers, Json(req)).await/g' backend/pq_shield/src/admin.rs

sed -i '' -e 's/async fn admin_list_api_keys(/async fn admin_list_api_keys(\n    Extension(caller): Extension<auth_service::AuthenticatedUser>,/g' backend/pq_shield/src/admin.rs
sed -i '' -e 's/auth_service::list_api_keys_handler(State(state.auth_state), headers).await/auth_service::list_api_keys_handler(State(state.auth_state), Extension(caller)).await/g' backend/pq_shield/src/admin.rs

sed -i '' -e 's/async fn admin_create_api_key(/async fn admin_create_api_key(\n    Extension(caller): Extension<auth_service::AuthenticatedUser>,/g' backend/pq_shield/src/admin.rs
sed -i '' -e 's/auth_service::create_api_key_handler(State(state.auth_state), headers, Json(req)).await/auth_service::create_api_key_handler(State(state.auth_state), Extension(caller), Json(req)).await/g' backend/pq_shield/src/admin.rs

sed -i '' -e 's/async fn admin_revoke_api_key(/async fn admin_revoke_api_key(\n    Extension(caller): Extension<auth_service::AuthenticatedUser>,/g' backend/pq_shield/src/admin.rs
sed -i '' -e 's/auth_service::revoke_api_key_handler(State(state.auth_state), Path(id), headers).await/auth_service::revoke_api_key_handler(State(state.auth_state), Path(id), Extension(caller)).await/g' backend/pq_shield/src/admin.rs

