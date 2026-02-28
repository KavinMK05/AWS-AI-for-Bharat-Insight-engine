# RDS Module — Skeleton (Phase 1)
# Gated by var.enable_rds in root main.tf.
# When enabled (Phase 8+), creates PostgreSQL 15 db.t3.micro.

resource "aws_db_subnet_group" "main" {
  name       = "${var.prefix}-db-subnet-group"
  subnet_ids = var.private_subnet_ids

  tags = {
    Name = "${var.prefix}-db-subnet-group"
  }
}

resource "aws_security_group" "rds" {
  name_prefix = "${var.prefix}-rds-"
  description = "RDS security group"
  vpc_id      = var.vpc_id

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [var.lambda_sg_id]
  }

  tags = {
    Name = "${var.prefix}-rds-sg"
  }
}

resource "aws_db_instance" "main" {
  identifier             = "${var.prefix}-postgres"
  engine                 = "postgres"
  engine_version         = "15"
  instance_class         = "db.t3.micro"
  allocated_storage      = 20
  storage_type           = "gp3"
  db_name                = "insightengine"
  username               = "insightengine"
  password               = var.master_password
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = false
  skip_final_snapshot    = true
  backup_retention_period = 7

  tags = {
    Name = "${var.prefix}-postgres"
  }
}
