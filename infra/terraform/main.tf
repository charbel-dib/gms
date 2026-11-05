# GMS on AWS: ECS Fargate (app) + RDS PostgreSQL 16 + ALB (HTTPS) + ECR + Secrets Manager + CloudWatch.
#
# Cost-conscious layout for a start-up SaaS (≈ $60–100/month at launch, see infra/README.md):
#   - app tasks run in public subnets with a public IP (no NAT gateway, saves ~$35/month)
#     but accept traffic ONLY from the load balancer's security group
#   - the database lives in private subnets and accepts traffic ONLY from the app
#   - TLS everywhere: ACM certificate on the ALB, verified TLS to RDS

terraform {
  required_version = ">= 1.6"
  required_providers {
    aws    = { source = "hashicorp/aws", version = "~> 5.60" }
    random = { source = "hashicorp/random", version = "~> 3.6" }
  }
  # Recommended once you have an S3 bucket for state:
  # backend "s3" {
  #   bucket = "gms-terraform-state-<account-id>"
  #   key    = "prod/terraform.tfstate"
  #   region = "eu-central-1"
  # }
}

provider "aws" {
  region = var.region
  default_tags {
    tags = { Project = "gms", Environment = var.environment, ManagedBy = "terraform" }
  }
}

locals {
  name = "gms-${var.environment}"
  azs  = slice(data.aws_availability_zones.available.names, 0, 2)
}

data "aws_availability_zones" "available" {
  state = "available"
}

data "aws_caller_identity" "me" {}
