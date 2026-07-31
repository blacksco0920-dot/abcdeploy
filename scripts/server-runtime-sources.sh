#!/usr/bin/env bash

# Provider detection and Docker CE repository planning for server-bootstrap.sh.
# This file deliberately has no side effects so its decisions can be tested in
# isolation. The bootstrap script owns all package-manager mutations.

abcdeploy_metadata_get() {
  command -v curl >/dev/null 2>&1 || return 1
  curl --noproxy '*' --connect-timeout 1 --max-time 2 -fsS "$@"
}

abcdeploy_detect_cloud_provider() {
  local override="${ABCDEPLOY_CLOUD_PROVIDER_OVERRIDE:-}"
  case "$override" in
    tencent | aliyun | huawei | unknown)
      printf '%s\n' "$override"
      return
      ;;
  esac

  local identity=""
  local path
  for path in \
    /sys/class/dmi/id/sys_vendor \
    /sys/class/dmi/id/product_name \
    /sys/class/dmi/id/board_vendor \
    /run/cloud-init/instance-data.json; do
    if [[ -r "$path" ]]; then
      identity+="$(head -c 131072 "$path" 2>/dev/null || true) "
    fi
  done

  if grep -Eqi 'tencent|qcloud' <<<"$identity"; then
    printf 'tencent\n'
    return
  fi
  if grep -Eqi 'alibaba|aliyun' <<<"$identity"; then
    printf 'aliyun\n'
    return
  fi
  if grep -Eqi 'huawei|huaweicloud' <<<"$identity"; then
    printf 'huawei\n'
    return
  fi

  # Query fixed link-local/provider endpoints only. Requests bypass proxies,
  # use tiny timeouts and never follow redirects or request credentials.
  if abcdeploy_metadata_get \
    http://metadata.tencentyun.com/latest/meta-data/instance-id >/dev/null 2>&1; then
    printf 'tencent\n'
    return
  fi

  local token=""
  token="$(abcdeploy_metadata_get -X PUT \
    -H 'X-aliyun-ecs-metadata-token-ttl-seconds:60' \
    http://100.100.100.200/latest/api/token 2>/dev/null || true)"
  if [[ -n "$token" ]] && abcdeploy_metadata_get \
    -H "X-aliyun-ecs-metadata-token:$token" \
    http://100.100.100.200/latest/meta-data/instance-id >/dev/null 2>&1; then
    printf 'aliyun\n'
    return
  fi

  token="$(abcdeploy_metadata_get -X PUT \
    -H 'X-Metadata-Token-Ttl-Seconds:60' \
    http://169.254.169.254/meta-data/latest/api/token 2>/dev/null || true)"
  if [[ -n "$token" ]] && abcdeploy_metadata_get \
    -H "X-Metadata-Token:$token" \
    http://169.254.169.254/meta-data/latest/instance-identity/signature \
    >/dev/null 2>&1; then
    printf 'huawei\n'
    return
  fi

  printf 'unknown\n'
}

abcdeploy_cloud_provider_label() {
  case "$1" in
    tencent) printf '腾讯云' ;;
    aliyun) printf '阿里云' ;;
    huawei) printf '华为云' ;;
    *) printf '未识别云厂商' ;;
  esac
}

abcdeploy_docker_source_plan() {
  local provider="$1"
  local distribution="$2"
  local tencent="https://mirrors.cloud.tencent.com/docker-ce/linux/$distribution"
  local aliyun="https://mirrors.aliyun.com/docker-ce/linux/$distribution"
  local huawei="https://mirrors.huaweicloud.com/docker-ce/linux/$distribution"
  local official="https://download.docker.com/linux/$distribution"

  case "$provider" in
    aliyun)
      printf 'aliyun|%s\ntencent|%s\nhuawei|%s\nofficial|%s\n' \
        "$aliyun" "$tencent" "$huawei" "$official"
      ;;
    huawei)
      printf 'huawei|%s\ntencent|%s\naliyun|%s\nofficial|%s\n' \
        "$huawei" "$tencent" "$aliyun" "$official"
      ;;
    tencent)
      printf 'tencent|%s\naliyun|%s\nhuawei|%s\nofficial|%s\n' \
        "$tencent" "$aliyun" "$huawei" "$official"
      ;;
    *)
      printf 'tencent|%s\naliyun|%s\nhuawei|%s\nofficial|%s\n' \
        "$tencent" "$aliyun" "$huawei" "$official"
      ;;
  esac
}

abcdeploy_docker_source_label() {
  case "$1" in
    tencent) printf '腾讯云 Docker 软件源' ;;
    aliyun) printf '阿里云 Docker 软件源' ;;
    huawei) printf '华为云 Docker 软件源' ;;
    official) printf 'Docker 官方软件源' ;;
    *) printf 'Docker 软件源' ;;
  esac
}
