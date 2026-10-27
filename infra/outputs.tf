output "resource_group_name" {
  description = "Resource group the environment is deployed into."
  value       = data.azurerm_resource_group.this.name
}

output "api_url" {
  description = "Public base URL of the Express API."
  value       = "https://${azurerm_container_app.api.ingress[0].fqdn}"
}

output "web_url" {
  description = "Public URL of the Static Web App (also the API's CORS origin)."
  value       = "https://${azurerm_static_web_app.web.default_host_name}"
}

output "postgres_fqdn" {
  description = "Fully qualified host name of the PostgreSQL server."
  value       = azurerm_postgresql_flexible_server.this.fqdn
}

output "key_vault_name" {
  description = "Key Vault holding the database credentials."
  value       = azurerm_key_vault.this.name
}

output "key_vault_uri" {
  description = "Key Vault URI."
  value       = azurerm_key_vault.this.vault_uri
}

output "static_web_app_name" {
  description = "SWA name for OIDC-authorized runtime retrieval of the deployment token."
  value       = azurerm_static_web_app.web.name
}

output "api_image" {
  value = var.api_image
}

output "database_jobs" {
  value = { for name, job in azurerm_container_app_job.database : name => job.name }
}
output "release_inputs" {
  description = "Persisted release selection; ordinary infrastructure plans must preserve these inputs."
  value = {
    api_image           = var.api_image
    migration_image     = var.migration_image
    application_enabled = var.application_enabled
  }
}
