# ---------- database ----------
resource "random_password" "db" {
  length  = 32
  special = false
}

resource "aws_db_subnet_group" "main" {
  name       = local.name
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_db_parameter_group" "pg16" {
  name   = "${local.name}-pg16"
  family = "postgres16"
  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }
  parameter {
    name  = "log_min_duration_statement"
    value = "500"
  }
}

resource "aws_db_instance" "main" {
  identifier                   = local.name
  engine                       = "postgres"
  engine_version               = "16"
  instance_class               = var.db_instance_class
  allocated_storage            = var.db_allocated_storage
  max_allocated_storage        = var.db_allocated_storage * 5
  storage_type                 = "gp3"
  storage_encrypted            = true
  db_name                      = "gms"
  username                     = "gms"
  password                     = random_password.db.result
  db_subnet_group_name         = aws_db_subnet_group.main.name
  vpc_security_group_ids       = [aws_security_group.db.id]
  parameter_group_name         = aws_db_parameter_group.pg16.name
  multi_az                     = var.db_multi_az
  publicly_accessible          = false
  backup_retention_period      = 14
  backup_window                = "01:00-02:00"
  maintenance_window           = "sun:02:30-sun:03:30"
  auto_minor_version_upgrade   = true
  deletion_protection          = true
  skip_final_snapshot          = false
  final_snapshot_identifier    = "${local.name}-final"
  performance_insights_enabled = true
  copy_tags_to_snapshot        = true
}

# ---------- secrets (values you fill once in the AWS console, see README) ----------
resource "random_password" "encryption_key" {
  length  = 48
  special = false
}

resource "random_password" "superadmin" {
  length  = 20
  special = false
}

resource "random_password" "wa_verify" {
  length  = 24
  special = false
}

resource "aws_secretsmanager_secret" "app" {
  name                    = "${local.name}/app"
  description             = "GMS application secrets"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "app" {
  secret_id = aws_secretsmanager_secret.app.id
  secret_string = jsonencode({
    DB_PASSWORD           = random_password.db.result
    ENCRYPTION_KEY        = random_password.encryption_key.result
    SUPERADMIN_PASSWORD   = random_password.superadmin.result
    WHATSAPP_VERIFY_TOKEN = random_password.wa_verify.result
    ANTHROPIC_API_KEY     = ""
    WHATSAPP_TOKEN        = ""
    WHATSAPP_APP_SECRET   = ""
  })
  # Keys you add or edit in the console (AI key, WhatsApp) are not overwritten by later applies.
  lifecycle {
    ignore_changes = [secret_string]
  }
}

# ---------- container registry ----------
resource "aws_ecr_repository" "app" {
  name                 = "gms"
  image_tag_mutability = "MUTABLE"
  image_scanning_configuration {
    scan_on_push = true
  }
  encryption_configuration {
    encryption_type = "AES256"
  }
}

resource "aws_ecr_lifecycle_policy" "app" {
  repository = aws_ecr_repository.app.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the last 20 images"
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 20 }
      action       = { type = "expire" }
    }]
  })
}
