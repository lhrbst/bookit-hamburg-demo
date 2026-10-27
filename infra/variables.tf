variable "environment" {
  description = "Deployment environment name (dev or prod)."
  type        = string

  validation {
    condition     = contains(["dev", "prod"], var.environment)
    error_message = "environment must be either \"dev\" or \"prod\"."
  }
}

variable "resource_group_name" {
  description = "Existing resource group the environment is deployed into. Chosen by the user per environment; never assumed."
  type        = string
}

variable "location" {
  description = "Azure region for the API, database, observability, and secret resources."
  type        = string
  default     = "northeurope"
}

variable "web_location" {
  description = "Azure region for the Static Web App. Static Web Apps are not offered in every region; the content is served globally."
  type        = string
  default     = "westeurope"
}

variable "postgres_sku_name" {
  description = "PostgreSQL Flexible Server SKU, in azurerm format (e.g. B_Standard_B1ms)."
  type        = string
  default     = "B_Standard_B1ms"
}

variable "postgres_storage_mb" {
  description = "PostgreSQL storage size in MB."
  type        = number
  default     = 32768
}

variable "database_name" {
  description = "Name of the application database created on the PostgreSQL server."
  type        = string
  default     = "bookit"
}

variable "database_admin_login" {
  description = "Administrator login for the PostgreSQL server. The password is generated and stored in Key Vault."
  type        = string
  default     = "bookitadmin"
}

variable "api_image" {
  description = "Persisted immutable release image. No default: every plan must load the current release inputs."
  type        = string
  validation {
    condition     = can(regex("@sha256:[0-9a-f]{64}$", var.api_image))
    error_message = "api_image must be pinned by digest."
  }
}

variable "application_enabled" {
  description = "False only during initial placeholder preparation; true once the real API has been published and migrated."
  type        = bool
  default     = false
}

variable "migration_image" {
  description = "Published public GHCR migrations image digest. Null keeps jobs absent until the first image is published."
  type        = string
  default     = null
  nullable    = true
  validation {
    condition     = var.migration_image == null ? true : can(regex("^ghcr.io/.+@sha256:[0-9a-f]{64}$", var.migration_image))
    error_message = "migration_image must be a public GHCR image pinned by digest."
  }
}

variable "operator_object_id" {
  description = "Stable operator object ID that already owns the infrastructure secret grant; provide via TF_VAR_operator_object_id, not the current CI caller."
  type        = string
}

variable "api_port" {
  description = "Port the API container listens on. Must match PORT in the backend (3001), or the placeholder image's port (80) until the real image is deployed."
  type        = number
  default     = 3001
}

variable "api_min_replicas" {
  description = "Minimum API replicas. 0 allows scale-to-zero, which is acceptable for dev."
  type        = number
  default     = 0
}

variable "api_max_replicas" {
  description = "Maximum API replicas."
  type        = number
  default     = 2
}

variable "log_retention_days" {
  description = "Retention in days for the Log Analytics workspace."
  type        = number
  default     = 30
}
