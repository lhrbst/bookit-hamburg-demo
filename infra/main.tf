data "azurerm_resource_group" "this" {
  name = var.resource_group_name
}

data "azurerm_client_config" "current" {}

resource "random_string" "suffix" {
  length  = 5
  upper   = false
  special = false
}

resource "random_password" "postgres_admin" {
  length  = 32
  special = false
}

locals {
  token = random_string.suffix.result

  tags = {
    environment = var.environment
    application = "bookit"
    managedBy   = "opentofu"
  }

  # Special characters are disabled on the password, so it needs no URL encoding.
  database_url = "postgres://${var.database_admin_login}:${random_password.postgres_admin.result}@${azurerm_postgresql_flexible_server.this.fqdn}:5432/${var.database_name}?sslmode=require"
}

# Observability

resource "azurerm_log_analytics_workspace" "this" {
  name                = "log-bookit-${var.environment}-${local.token}"
  location            = var.location
  resource_group_name = data.azurerm_resource_group.this.name
  sku                 = "PerGB2018"
  retention_in_days   = var.log_retention_days
  tags                = local.tags
}

resource "azurerm_application_insights" "this" {
  name                = "appi-bookit-${var.environment}-${local.token}"
  location            = var.location
  resource_group_name = data.azurerm_resource_group.this.name
  workspace_id        = azurerm_log_analytics_workspace.this.id
  application_type    = "web"
  tags                = local.tags
}

# Secrets

resource "azurerm_key_vault" "this" {
  name                          = "kv-bookit-${var.environment}-${local.token}"
  location                      = var.location
  resource_group_name           = data.azurerm_resource_group.this.name
  tenant_id                     = data.azurerm_client_config.current.tenant_id
  sku_name                      = "standard"
  rbac_authorization_enabled    = true
  purge_protection_enabled      = false
  soft_delete_retention_days    = 7
  public_network_access_enabled = true
  tags                          = local.tags
}

resource "azurerm_role_assignment" "deployer_key_vault_secrets" {
  scope                = azurerm_key_vault.this.id
  role_definition_name = "Key Vault Secrets Officer"
  principal_id         = var.operator_object_id
}

resource "azurerm_key_vault_secret" "postgres_admin_password" {
  name         = "postgres-admin-password"
  value        = random_password.postgres_admin.result
  key_vault_id = azurerm_key_vault.this.id
  depends_on   = [azurerm_role_assignment.deployer_key_vault_secrets]
}

resource "azurerm_key_vault_secret" "database_url" {
  name         = "database-url"
  value        = local.database_url
  key_vault_id = azurerm_key_vault.this.id
  depends_on   = [azurerm_role_assignment.deployer_key_vault_secrets]
}

# Database

resource "azurerm_postgresql_flexible_server" "this" {
  name                          = "psql-bookit-${var.environment}-${local.token}"
  location                      = var.location
  resource_group_name           = data.azurerm_resource_group.this.name
  version                       = "16"
  sku_name                      = var.postgres_sku_name
  storage_mb                    = var.postgres_storage_mb
  backup_retention_days         = 7
  geo_redundant_backup_enabled  = false
  administrator_login           = var.database_admin_login
  administrator_password        = random_password.postgres_admin.result
  public_network_access_enabled = true
  tags                          = local.tags

  authentication {
    active_directory_auth_enabled = false
    password_auth_enabled         = true
  }
  lifecycle {
    # Preserve Azure's assigned zone during unrelated application releases.
    ignore_changes = [zone]
  }
}

# Dev only: lets Azure-hosted services (the Container App) reach the server. Prod must use private networking.
resource "azurerm_postgresql_flexible_server_firewall_rule" "allow_azure_services" {
  name             = "allow-azure-services"
  server_id        = azurerm_postgresql_flexible_server.this.id
  start_ip_address = "0.0.0.0"
  end_ip_address   = "0.0.0.0"
}

# btree_gist must be allowlisted before migration 0001 can CREATE EXTENSION (ADR-003).
resource "azurerm_postgresql_flexible_server_configuration" "azure_extensions" {
  name      = "azure.extensions"
  server_id = azurerm_postgresql_flexible_server.this.id
  value     = "BTREE_GIST"
}

resource "azurerm_postgresql_flexible_server_database" "bookit" {
  name      = var.database_name
  server_id = azurerm_postgresql_flexible_server.this.id
  charset   = "UTF8"
  collation = "en_US.utf8"
}

resource "azurerm_monitor_diagnostic_setting" "postgres" {
  name                       = "diag-psql"
  target_resource_id         = azurerm_postgresql_flexible_server.this.id
  log_analytics_workspace_id = azurerm_log_analytics_workspace.this.id

  enabled_log {
    category_group = "allLogs"
  }

  enabled_metric {
    category = "AllMetrics"
  }
}

resource "azurerm_monitor_diagnostic_setting" "key_vault" {
  name                       = "diag-kv"
  target_resource_id         = azurerm_key_vault.this.id
  log_analytics_workspace_id = azurerm_log_analytics_workspace.this.id

  enabled_log {
    category_group = "allLogs"
  }

  enabled_metric {
    category = "AllMetrics"
  }
}

# API

resource "azurerm_container_app_environment" "this" {
  name                       = "cae-bookit-${var.environment}"
  location                   = var.location
  resource_group_name        = data.azurerm_resource_group.this.name
  log_analytics_workspace_id = azurerm_log_analytics_workspace.this.id
  tags                       = local.tags
  workload_profile {
    name                  = "Consumption"
    workload_profile_type = "Consumption"
  }
}

resource "azurerm_container_app" "api" {
  name                         = "ca-bookit-api-${var.environment}"
  container_app_environment_id = azurerm_container_app_environment.this.id
  resource_group_name          = data.azurerm_resource_group.this.name
  revision_mode                = "Single"
  workload_profile_name        = "Consumption"
  tags                         = local.tags

  identity {
    type         = "SystemAssigned, UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.workload["api"].id]
  }

  dynamic "secret" {
    for_each = var.application_enabled ? [1] : []
    content {
      name                = "database-url"
      identity            = azurerm_user_assigned_identity.workload["api"].id
      key_vault_secret_id = azurerm_key_vault_secret.role_url["runtime"].versionless_id
    }
  }

  ingress {
    external_enabled = true
    target_port      = var.application_enabled ? var.api_port : 80
    transport        = "auto"

    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }

  template {
    min_replicas = var.api_min_replicas
    max_replicas = var.api_max_replicas

    container {
      name   = "api"
      image  = var.api_image
      cpu    = 0.25
      memory = "0.5Gi"

      env {
        name  = "PORT"
        value = tostring(var.api_port)
      }

      env {
        name  = "NODE_ENV"
        value = "production"
      }

      env {
        name  = "CURRENT_PERSON_ID"
        value = "22222222-2222-2222-2222-222222222221"
      }

      env {
        name  = "CORS_ORIGIN"
        value = "https://${azurerm_static_web_app.web.default_host_name}"
      }

      dynamic "env" {
        for_each = var.application_enabled ? [1] : []
        content {
          name        = "DATABASE_URL"
          secret_name = "database-url"
        }
      }

      env {
        name  = "APPLICATIONINSIGHTS_CONNECTION_STRING"
        value = azurerm_application_insights.this.connection_string
      }

      liveness_probe {
        transport = "HTTP"
        path      = var.application_enabled ? "/health" : "/"
        port      = var.application_enabled ? var.api_port : 80
      }

      dynamic "startup_probe" {
        for_each = var.application_enabled ? [1] : []
        content {
          transport = "HTTP"
          path      = "/health"
          port      = var.api_port
        }
      }

      dynamic "readiness_probe" {
        for_each = var.application_enabled ? [1] : []
        content {
          transport = "HTTP"
          path      = "/ready"
          port      = var.api_port
        }
      }
    }
  }
  depends_on = [azurerm_role_assignment.workload_secret]

  lifecycle {
    precondition {
      condition     = !var.application_enabled || (var.migration_image != null && startswith(var.api_image, "ghcr.io/"))
      error_message = "Enable the application only with published public GHCR API and migration digests."
    }
  }
}

# Web

resource "azurerm_static_web_app" "web" {
  name                = "swa-bookit-${var.environment}-${local.token}"
  resource_group_name = data.azurerm_resource_group.this.name
  location            = var.web_location
  sku_tier            = "Free"
  sku_size            = "Free"
  tags                = local.tags
}
