variable "github_repository" {
  description = "Repository trusted for the dev GitHub environment."
  type        = string
  default     = "lhrbst/bookit-hamburg-demo"
}

data "azurerm_resource_group" "application" {
  name = var.resource_group_name
}

resource "azurerm_user_assigned_identity" "github_dev" {
  name                = "id-bookit-github-dev"
  location            = var.location
  resource_group_name = var.resource_group_name
  tags = {
    application = "bookit"
    environment = "dev"
    managedBy   = "opentofu"
  }
}

resource "azurerm_federated_identity_credential" "github_dev" {
  name                      = "github-dev"
  user_assigned_identity_id = azurerm_user_assigned_identity.github_dev.id
  audience                  = ["api://AzureADTokenExchange"]
  issuer                    = "https://token.actions.githubusercontent.com"
  subject                   = "repo:${var.github_repository}:environment:dev"
}

resource "azurerm_role_assignment" "github_resources" {
  scope                = data.azurerm_resource_group.application.id
  role_definition_name = "Contributor"
  principal_id         = azurerm_user_assigned_identity.github_dev.principal_id
  principal_type       = "ServicePrincipal"
}

resource "azurerm_role_assignment" "github_state" {
  scope                = azurerm_storage_container.state.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = azurerm_user_assigned_identity.github_dev.principal_id
  principal_type       = "ServicePrincipal"
}

resource "azurerm_role_assignment" "github_secrets" {
  scope                = data.azurerm_resource_group.application.id
  role_definition_name = "Key Vault Secrets Officer"
  principal_id         = azurerm_user_assigned_identity.github_dev.principal_id
  principal_type       = "ServicePrincipal"
}

# The deployment may assign secret-reader roles, not grant itself arbitrary Azure roles.
resource "azurerm_role_assignment" "github_secret_role_assignments" {
  scope                = data.azurerm_resource_group.application.id
  role_definition_name = "Key Vault Data Access Administrator"
  principal_id         = azurerm_user_assigned_identity.github_dev.principal_id
  principal_type       = "ServicePrincipal"
  condition_version    = "2.0"
  condition            = <<-CONDITION
    (
      (!(ActionMatches{'Microsoft.Authorization/roleAssignments/write'}))
      OR
      (@Request[Microsoft.Authorization/roleAssignments:RoleDefinitionId] ForAnyOfAnyValues:GuidEquals {4633458b-17de-408a-b874-0445c86b69e6})
    )
    AND
    (
      (!(ActionMatches{'Microsoft.Authorization/roleAssignments/delete'}))
      OR
      (@Resource[Microsoft.Authorization/roleAssignments:RoleDefinitionId] ForAnyOfAnyValues:GuidEquals {4633458b-17de-408a-b874-0445c86b69e6})
    )
  CONDITION
}

resource "azurerm_storage_container" "bootstrap" {
  name                  = "tfstate-bootstrap"
  storage_account_id    = azurerm_storage_account.state.id
  container_access_type = "private"
  depends_on            = [azurerm_role_assignment.deployer_blob]
  lifecycle {
    prevent_destroy = true
  }
}

output "github_client_id" {
  value = azurerm_user_assigned_identity.github_dev.client_id
}

output "github_principal_id" {
  value = azurerm_user_assigned_identity.github_dev.principal_id
}

output "bootstrap_state_container_name" {
  value = azurerm_storage_container.bootstrap.name
}
