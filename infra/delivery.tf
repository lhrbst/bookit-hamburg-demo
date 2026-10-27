resource "random_password" "database_role" {
  for_each = toset(["runtime", "migrator"])
  length   = 32
  special  = false
}

locals {
  role_urls = {
    runtime  = "postgres://bookit_runtime:${random_password.database_role["runtime"].result}@${azurerm_postgresql_flexible_server.this.fqdn}:5432/${var.database_name}?sslmode=verify-full"
    migrator = "postgres://bookit_migrator:${random_password.database_role["migrator"].result}@${azurerm_postgresql_flexible_server.this.fqdn}:5432/${var.database_name}?sslmode=verify-full"
  }
  workload_secrets = {
    api       = ["runtime"]
    release   = ["migrator"]
    provision = ["admin", "migrator", "runtime"]
  }
  secret_ids = merge(
    { for role, secret in azurerm_key_vault_secret.role_url : role => secret.versionless_id },
    { admin = azurerm_key_vault_secret.database_url.versionless_id }
  )
  secret_access = merge([
    for workload, secrets in local.workload_secrets : {
      for secret in secrets : "${workload}-${secret}" => {
        workload = workload
        secret   = secret
      }
    }
  ]...)
}

resource "azurerm_key_vault_secret" "role_url" {
  for_each     = local.role_urls
  name         = "database-${each.key}-url"
  value        = each.value
  key_vault_id = azurerm_key_vault.this.id
  depends_on   = [azurerm_role_assignment.deployer_key_vault_secrets]
}

resource "azurerm_user_assigned_identity" "workload" {
  for_each            = local.workload_secrets
  name                = "id-bookit-${each.key}-${var.environment}"
  resource_group_name = data.azurerm_resource_group.this.name
  location            = var.location
  tags                = local.tags
}

resource "azurerm_role_assignment" "workload_secret" {
  for_each             = local.secret_access
  scope                = "${azurerm_key_vault.this.id}/secrets/${each.value.secret == "admin" ? azurerm_key_vault_secret.database_url.name : azurerm_key_vault_secret.role_url[each.value.secret].name}"
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_user_assigned_identity.workload[each.value.workload].principal_id
  principal_type       = "ServicePrincipal"
}

resource "azurerm_container_app_job" "database" {
  for_each                     = var.migration_image == null ? toset([]) : toset(["provision", "release"])
  name                         = "job-bookit-${each.key}-${var.environment}"
  location                     = var.location
  resource_group_name          = data.azurerm_resource_group.this.name
  container_app_environment_id = azurerm_container_app_environment.this.id
  replica_timeout_in_seconds   = 600
  replica_retry_limit          = 0
  tags                         = local.tags

  manual_trigger_config {
    parallelism              = 1
    replica_completion_count = 1
  }

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.workload[each.key].id]
  }

  dynamic "secret" {
    for_each = toset(local.workload_secrets[each.key])
    content {
      name                = "database-${secret.value}"
      identity            = azurerm_user_assigned_identity.workload[each.key].id
      key_vault_secret_id = local.secret_ids[secret.value]
    }
  }

  template {
    container {
      name    = "database"
      image   = var.migration_image
      cpu     = 0.25
      memory  = "0.5Gi"
      command = ["node", "scripts/database.mjs", each.key]
      dynamic "env" {
        for_each = each.key == "provision" ? {
          DATABASE_ADMIN_URL     = "admin"
          MIGRATION_DATABASE_URL = "migrator"
          RUNTIME_DATABASE_URL   = "runtime"
          } : {
          MIGRATION_DATABASE_URL = "migrator"
        }
        content {
          name        = env.key
          secret_name = "database-${env.value}"
        }
      }
    }
  }
  depends_on = [
    azurerm_role_assignment.workload_secret,
    azurerm_postgresql_flexible_server_configuration.azure_extensions,
    azurerm_postgresql_flexible_server_database.bookit,
  ]
}
