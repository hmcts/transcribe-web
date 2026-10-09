# ---------------------------------------------------------------------------
# Injected by the CNP pipeline via -var. Do NOT set these in a .tfvars file.
# ---------------------------------------------------------------------------
variable "product" {}

variable "component" {}

variable "env" {}

variable "subscription" {}

variable "location" {
  default = "UK South"
}

variable "common_tags" {
  type = map(string)
}

# ---------------------------------------------------------------------------
# Session store sizing. Basic C1 outside production, as em-icp-api does;
# prod.tfvars raises it.
# ---------------------------------------------------------------------------
variable "redis_sku_name" {
  default = "Basic"
}

variable "redis_family" {
  default = "C"
}

variable "redis_capacity" {
  default = "1"
}
