variable "aws_region" {
  default = "ap-northeast-2"
}

variable "environment" {
  default = "production"
}

variable "project_name" {
  default = "dart-notification"
}

variable "db_username" {
  default   = "dartadmin"
  sensitive = true
}

variable "db_password" {
  sensitive = true
}

variable "db_name" {
  default = "dart_notification"
}

variable "jwt_secret" {
  sensitive = true
}

variable "jwt_refresh_secret" {
  sensitive = true
}

variable "dart_api_key" {
  sensitive = true
}

variable "kakao_rest_api_key" {
  sensitive = true
}

variable "kakao_client_secret" {
  sensitive = true
}

variable "api_base_url" {
  default = ""
}
