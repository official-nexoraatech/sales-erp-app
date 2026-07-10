{{/*
Deployment labels — matches the exact 3-field label set already on every existing
infrastructure/k8s/*.yaml Deployment (app/version/part-of). Deliberately does not add
Helm's usual chart/managed-by labels — this chart reproduces the existing manifest shape
1:1, it doesn't redesign it.
*/}}
{{- define "erp.labels" -}}
app: {{ .name }}
version: v1
part-of: erp
{{- end -}}

{{/*
Selector labels — must stay stable across releases, do not add chart/version here.
*/}}
{{- define "erp.selectorLabels" -}}
app: {{ .name }}
{{- end -}}

{{/*
Full image reference for a service: <registry>/<name>:<tag>
*/}}
{{- define "erp.image" -}}
{{- printf "%s/%s:%s" .global.imageRegistry .name .global.imageTag -}}
{{- end -}}

{{/*
Resolved resources block for a service — per-service `resources` (requests/limits, either or
both) override `global.resources.default` field by field.
*/}}
{{- define "erp.resources" -}}
{{- $d := .global.resources.default -}}
{{- $o := .svc.resources | default dict -}}
{{- $oReq := $o.requests | default dict -}}
{{- $oLim := $o.limits | default dict -}}
requests:
  cpu: {{ $oReq.cpu | default $d.requests.cpu }}
  memory: {{ $oReq.memory | default $d.requests.memory }}
limits:
  cpu: {{ $oLim.cpu | default $d.limits.cpu }}
  memory: {{ $oLim.memory | default $d.limits.memory }}
{{- end -}}

{{/*
Vault Agent secret-injection template for DATABASE_URL — this block is written verbatim into
a pod annotation and evaluated by the Vault Agent Injector's own templating engine, NOT by
Helm, so the {{ }} delimiters below must be emitted as literal text (see the {{ "{{" }} /
{{ "}}" }} trick used throughout). Takes a role name (string).
*/}}
{{- define "erp.vaultDbBlock" -}}
{{ "{{-" }} with secret "erp/data/{{ . }}/db" -{{ "}}" }}
export DATABASE_URL="{{ "{{" }} .Data.data.url {{ "}}" }}"
{{ "{{-" }} end {{ "}}" }}
{{- end -}}

{{/*
Vault Agent secret-injection template for JWT keys — same "emit literal {{ }}" caveat as
erp.vaultDbBlock above. Takes a dict: { Role: <string>, Both: <bool> }. Both=true also emits
JWT_PRIVATE_KEY (auth-service only — every other service only ever reads the public key).
*/}}
{{- define "erp.vaultJwtBlock" -}}
{{ "{{-" }} with secret "erp/data/{{ .Role }}/jwt" -{{ "}}" }}
{{- if .Both }}
export JWT_PRIVATE_KEY="{{ "{{" }} .Data.data.private_key {{ "}}" }}"
{{- end }}
export JWT_PUBLIC_KEY="{{ "{{" }} .Data.data.public_key {{ "}}" }}"
{{ "{{-" }} end {{ "}}" }}
{{- end -}}
