# RDS Module — Publicly Accessible PostgreSQL (Phase 8)
# No VPC required — Lambdas connect over the internet.
# Gated by var.enable_rds in root main.tf.

# Use the default VPC
data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

resource "aws_db_subnet_group" "main" {
  name       = "${var.prefix}-db-subnet-group"
  subnet_ids = data.aws_subnets.default.ids

  tags = {
    Name = "${var.prefix}-db-subnet-group"
  }
}

resource "aws_security_group" "rds" {
  name_prefix = "${var.prefix}-rds-"
  description = "RDS security group - allows inbound PostgreSQL"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = var.allowed_cidr_blocks
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.prefix}-rds-sg"
  }
}

resource "aws_db_instance" "main" {
  identifier              = "${var.prefix}-postgres"
  engine                  = "postgres"
  engine_version          = "15"
  instance_class          = "db.t3.micro"
  allocated_storage       = 20
  storage_type            = "gp3"
  db_name                 = "insightengine"
  username                = "insightengine"
  password                = var.master_password
  db_subnet_group_name    = aws_db_subnet_group.main.name
  vpc_security_group_ids  = [aws_security_group.rds.id]
  publicly_accessible     = true
  skip_final_snapshot     = true
  backup_retention_period = 7

  tags = {
    Name = "${var.prefix}-postgres"
  }
}
