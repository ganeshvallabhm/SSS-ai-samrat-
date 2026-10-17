#!/bin/bash
# End-to-end curl demo:
# 1. Login citizen
# 2. List tasks
# 3. Create submission with real photo
# 4. Get submission status and timeline
# 5. Download submission photo

set -e

BASE_URL="http://localhost:8000/api/v1"
PHOTO_PATH="/tmp/demo_sapling.jpg"

echo "=== SSS Civic Tech: Citizen Tasks & Submissions cURL Demo ==="

# 1. Create temporary JPEG photo
python3 -c "
with open('$PHOTO_PATH', 'wb') as f:
    f.write(b'\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x01\x00\`\x00\`\x00\x00\xff\xdb\x00C\x00\x08\x06\x06\x07\x06\x05\x08\x07\x07\x07\t\t\x08\n\x0c\x14\r\x0c\x0b\x0b\x0c\x19\x12\x13\x0f\x14\x1d\x1a\x1f\x1e\x1d\x1a\x1c\x1c $.\' \",#\x1c\x1c(7),01444\x1f\'9=82<.342\xff\xc0\x00\x0b\x08\x00\x01\x00\x01\x01\x01\x11\x00\xff\xc4\x00\x1f\x00\x00\x01\x05\x01\x01\x01\x01\x01\x01\x00\x00\x00\x00\x00\x00\x00\x00\x01\x02\x03\x04\x05\x06\x07\x08\t\n\x0b\xff\xda\x00\x08\x01\x01\x00\x00?\x00\xbf\x00\xff\xd9')
"

# 2. Login as citizen
echo -e "\n--> Step 1: Login via OTP Verify"
LOGIN_RESP=$(curl -s -X POST "$BASE_URL/auth/otp/verify" \
  -H "Content-Type: application/json" \
  -d '{"phone": "+919900000042", "code": "424242"}')
echo "$LOGIN_RESP" | jq .

TOKEN=$(echo "$LOGIN_RESP" | jq -r .accessToken)

# 3. List tasks
echo -e "\n--> Step 2: List Tasks"
TASKS_RESP=$(curl -s -X GET "$BASE_URL/tasks?category=green&lat=17.4682&lng=78.3618" \
  -H "Authorization: Bearer $TOKEN")
echo "$TASKS_RESP" | jq .

TASK_ID=$(echo "$TASKS_RESP" | jq -r '.items[0].id')
echo "Selected Task ID: $TASK_ID"

# 4. Create submission
NOW_ISO=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
echo -e "\n--> Step 3: Create Live Submission with Photo"
SUB_RESP=$(curl -s -X POST "$BASE_URL/submissions" \
  -H "Authorization: Bearer $TOKEN" \
  -F "photo=@$PHOTO_PATH;type=image/jpeg" \
  -F "lat=17.46821" \
  -F "lng=78.36184" \
  -F "accuracy=8.5" \
  -F "timestamp=$NOW_ISO" \
  -F "categoryId=green" \
  -F "taskId=$TASK_ID" \
  -F "note=Citizen planted native sapling on the lake trail." \
  -F "address=Kondapur Lake Trail, Ward 104")
echo "$SUB_RESP" | jq .

SUB_ID=$(echo "$SUB_RESP" | jq -r .id)
echo "Created Submission ID: $SUB_ID"

# 5. Get submission details
echo -e "\n--> Step 4: Get Submission Status"
curl -s -X GET "$BASE_URL/submissions/$SUB_ID" \
  -H "Authorization: Bearer $TOKEN" | jq .

# 6. Download photo
echo -e "\n--> Step 5: Download Submission Photo"
HTTP_CODE=$(curl -s -o /tmp/downloaded_photo.jpg -w "%{http_code}" -X GET "$BASE_URL/submissions/$SUB_ID/photo" \
  -H "Authorization: Bearer $TOKEN")
echo "Photo Download HTTP Status: $HTTP_CODE (Saved to /tmp/downloaded_photo.jpg, Size: $(wc -c < /tmp/downloaded_photo.jpg) bytes)"

echo -e "\n=== Demo Completed Successfully ==="
