#!/usr/bin/env bash
# Popula o agro-backend local com dados mínimos para testar o app mobile:
# organização -> comunidade -> agricultor -> cultura -> safra.
#
# Uso:  ./scripts/seed-dev.sh [URL_DA_API]
# Requer: backend rodando e `jq` instalado.
set -euo pipefail

API="${1:-http://localhost:8080}"
ADMIN_EMAIL="admin@admin.com"
ADMIN_PASS="12345678"

# Credenciais do agricultor criado — use estas para entrar no app como FARMER.
FARMER_EMAIL="agricultor@teste.com"
FARMER_PASS="12345678"
FARMER_CPF="52998224725"   # CPF válido (o backend valida com @CPF)

say() { printf '\n\033[1;32m==>\033[0m %s\n' "$1"; }

say "Autenticando como admin em $API"
TOKEN=$(curl -sf -X POST "$API/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASS\"}" | jq -r .token)
AUTH=(-H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json')

say "Criando organização"
ORG_ID=$(curl -sf -X POST "$API/organizations" "${AUTH[@]}" \
  -d '{"name":"Cooperativa Vale do Mundaú","taxId":"12345678000199","type":"COOP"}' | jq -r .id)
echo "organização: $ORG_ID"

say "Criando comunidade"
COMM_ID=$(curl -sf -X POST "$API/organizations/$ORG_ID/communities" "${AUTH[@]}" \
  -d '{"name":"Assentamento Boa Esperança"}' | jq -r .id)
echo "comunidade: $COMM_ID"

say "Criando agricultor"
PROD_ID=$(curl -sf -X POST "$API/communities/$COMM_ID/farmers" "${AUTH[@]}" \
  -d "{\"fullName\":\"José da Silva\",\"email\":\"$FARMER_EMAIL\",\"password\":\"$FARMER_PASS\",\"cpf\":\"$FARMER_CPF\",\"dateOfBirth\":\"1968-04-12\",\"aliasName\":\"Sítio Boa Vista\"}" | jq -r .id)
echo "agricultor: $PROD_ID"

say "Garantindo culturas"
for c in '{"name":"Milho","variety":"BR-106","isPriority":true}' \
         '{"name":"Feijão","variety":"Carioca","isPriority":false}' \
         '{"name":"Mandioca","variety":"Aipim","isPriority":true}'; do
  curl -s -o /dev/null -X POST "$API/crops/register" "${AUTH[@]}" -d "$c" || true
done
CROP_ID=$(curl -sf "$API/crops" "${AUTH[@]}" | jq -r '.[0].id')
echo "cultura usada: $CROP_ID"

say "Garantindo safras"
curl -s -o /dev/null -X POST "$API/harvests/register" "${AUTH[@]}" \
  -d '{"label":"Safra 2026/2027","startDate":"2026-09-01","endDate":"2027-03-31"}' || true
HARVEST_ID=$(curl -sf "$API/harvests" "${AUTH[@]}" | jq -r '.[0].id')
echo "safra usada: $HARVEST_ID"

say "Criando plano de produção com apontamento"
PLAN_ID=$(curl -sf -X POST "$API/farmers/$PROD_ID/production-plans" "${AUTH[@]}" \
  -d "{\"cropId\":\"$CROP_ID\",\"harvestId\":\"$HARVEST_ID\",\"plantedArea\":12.5,\"expectedYield\":400,\"plannedPlantingDate\":\"2026-10-05\"}" | jq -r .id)
curl -s -o /dev/null -X POST "$API/production-plans/$PLAN_ID/executions" "${AUTH[@]}" \
  -d '{"actualYield":150,"harvestDate":"2027-01-20"}'
echo "plano: $PLAN_ID"

cat <<MSG

Pronto. Entre no app com:

  FARMER  $FARMER_EMAIL / $FARMER_PASS   (cai direto nos próprios planos)
  ADMIN     $ADMIN_EMAIL / $ADMIN_PASS         (escolhe o agricultor antes)

MSG
