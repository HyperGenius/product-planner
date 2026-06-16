variable "project" {
  type = object({
    id     = string
    region = string
    number = string
  })
}

variable "apis" {
  type = map(object({
    service = string
  }))
  default = {}
}
