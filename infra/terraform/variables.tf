variable "region" {
  description = "AWS region. eu-central-1 (Frankfurt) and eu-south-1 (Milan) have the lowest latency to Lebanon among EU regions; me-central-1 (UAE) is closer still."
  type        = string
  default     = "eu-central-1"
}

variable "environment" {
  type    = string
  default = "prod"
}

variable "domain_name" {
  description = "Public hostname of the app, e.g. app.gms-lb.com. Leave empty to start without a domain: you get a free https://xxxx.cloudfront.net address."
  type        = string
  default     = ""
}

variable "route53_zone_id" {
  description = "Route 53 hosted zone ID for the domain. Leave empty if your DNS is elsewhere: then create the ACM validation and CNAME records by hand (see outputs)."
  type        = string
  default     = ""
}

variable "image_tag" {
  description = "Docker image tag to deploy (pushed to the ECR repository created here)"
  type        = string
  default     = "latest"
}

variable "app_cpu" {
  type    = number
  default = 512
}

variable "app_memory" {
  type    = number
  default = 1024
}

variable "app_desired_count" {
  description = "2 tasks = no downtime during deploys and if one task fails"
  type        = number
  default     = 2
}

variable "app_max_count" {
  type    = number
  default = 4
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.micro"
}

variable "db_allocated_storage" {
  type    = number
  default = 20
}

variable "db_multi_az" {
  description = "Standby replica in a second AZ (doubles DB cost). Turn on once you have paying gyms that depend on it."
  type        = bool
  default     = false
}

variable "superadmin_email" {
  description = "Login of the GMS platform admin (you)"
  type        = string
}

variable "alarm_email" {
  description = "Email that receives alarms (app down, DB CPU, 5xx errors). Leave empty to skip."
  type        = string
  default     = ""
}
