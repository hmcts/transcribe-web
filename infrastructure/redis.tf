# Server-side session store for the frontend's own Entra ID login.
#
# On CNP there is no App Service Easy Auth, so this app runs the OIDC login
# itself and keeps users' tokens server-side, keyed by an opaque cookie — the
# CNP pattern for internal users (DARTS keeps its sessions in Redis too).
# Sessions have to be shared across replicas and survive a pod restart, so they
# cannot live in process memory.
#
# Frontend-only, so it is component infrastructure (here) rather than shared
# infrastructure. Private: the module's private endpoint goes in
# core-infra-vnet-<env>, in this subscription, with DNS in the central zone.
module "session_redis" {
  source = "git@github.com:hmcts/cnp-module-redis?ref=master"

  product       = "${var.product}-${var.component}-session"
  location      = var.location
  env           = var.env
  common_tags   = var.common_tags
  business_area = "cft"

  redis_version                 = "6"
  private_endpoint_enabled      = true
  public_network_access_enabled = false

  sku_name = var.redis_sku_name
  family   = var.redis_family
  capacity = var.redis_capacity
}

# The product Key Vault, from transcribe-shared-infrastructure. Named
# "<product>-<env>" but in the shared-infrastructure resource group.
data "azurerm_key_vault" "transcribe" {
  name                = "${var.product}-${var.env}"
  resource_group_name = "${var.product}-shared-infrastructure-${var.env}"
}

# Mounted into the pod as REDIS_URL by charts/transcribe-web/values.yaml.
# rediss:// — the module only exposes the TLS port.
resource "azurerm_key_vault_secret" "redis_url" {
  name = "web-redis-connection-string"
  value = format(
    "rediss://:%s@%s:%s",
    urlencode(module.session_redis.access_key),
    module.session_redis.host_name,
    module.session_redis.redis_port,
  )
  key_vault_id = data.azurerm_key_vault.transcribe.id
}
