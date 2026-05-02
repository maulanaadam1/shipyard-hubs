import requests

url = "http://localhost:3000/api/auth/login"
payload = {"email": "admin", "password": "admin123"}
headers = {"Content-Type": "application/json"}

try:
    response = requests.post(url, json=payload, headers=headers)
    print(f"Status: {response.status_code}")
    print(f"Response: {response.text}")
except Exception as e:
    print(f"Error: {e}")
