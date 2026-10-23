provider "azurerm" {
  features {}

  storage_use_azuread = true
}

variable "resource_group_name" {
  description = "Resource group that holds the Terraform state account."
  type        = string
  default     = "rg-Momme-Ristow"
}

variable "location" {
  description = "Region for the state account."
  type        = string
  default     = "northeurope"
}

data "azurerm_client_config" "current" {}

resource "random_string" "suffix" {
  length  = 6
  upper   = false
  special = false
}

resource "azurerm_storage_account" "state" {
  name                            = "stbookittfstate${random_string.suffix.result}"
  resource_group_name             = var.resource_group_name
  location                        = var.location
  account_tier                    = "Standard"
  account_replication_type        = "LRS"
  min_tls_version                 = "TLS1_2"
  allow_nested_items_to_be_public = false
  shared_access_key_enabled       = false
  default_to_oauth_authentication = true

  blob_properties {
    versioning_enabled = true

    delete_retention_policy {
      days = 30
    }

    container_delete_retention_policy {
      days = 30
    }
  }

  tags = {
    application = "bookit"
    managedBy   = "opentofu"
    purpose     = "tofu-state"
  }
}

resource "azurerm_role_assignment" "deployer_blob" {
  scope                = azurerm_storage_account.state.id
  role_definition_name = "Storage Blob Data Owner"
  principal_id         = data.azurerm_client_config.current.object_id
}

resource "azurerm_storage_container" "state" {
  name                  = "tfstate"
  storage_account_id    = azurerm_storage_account.state.id
  container_access_type = "private"

  depends_on = [azurerm_role_assignment.deployer_blob]
}

output "state_resource_group_name" {
  value = var.resource_group_name
}

output "state_storage_account_name" {
  value = azurerm_storage_account.state.name
}

output "state_container_name" {
  value = azurerm_storage_container.state.name
}
