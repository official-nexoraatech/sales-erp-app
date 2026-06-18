# Users Module API Requirements

## Already Integrated

### Create User

`POST /api/v1/users`

Request:

```json
{
  "firstName": "string",
  "lastName": "string",
  "userName": "string",
  "email": "user@example.com",
  "mobileNo": "string",
  "roleId": 0,
  "organizationId": 0,
  "password": "string",
  "status": true
}
```

## Required APIs To Complete Users Pages

### Users List

`GET /api/v1/users?page=0&size=20&search=`

Expected response:

```json
{
  "success": true,
  "message": "Users retrieved successfully",
  "data": {
    "content": [
      {
        "id": 1,
        "userName": "admin",
        "firstName": "Admin",
        "lastName": "User",
        "email": "admin@example.com",
        "mobileNo": "9876598765",
        "roleId": 1,
        "roleName": "Admin",
        "organizationId": 1,
        "status": true,
        "createdBy": "admin",
        "createdAt": "2026-06-06T10:00:00"
      }
    ],
    "page": 0,
    "size": 20,
    "totalElements": 1,
    "totalPages": 1,
    "last": true
  },
  "timestamp": "2026-06-06T10:00:00"
}
```

### User Detail

`GET /api/v1/users/{id}`

Required for edit/view pages and direct reload support.

### Update User

`PUT /api/v1/users/{id}`

Use the same fields as create user. Prefer excluding password from normal edit, or allow an optional password field.

### Delete User

`DELETE /api/v1/users/{id}`

Required for row delete and selected delete.

### Change User Status

Preferred:

`PUT /api/v1/users/{id}/status`

Request:

```json
{
  "status": true
}
```

## Required APIs For Role Dropdown And Roles Page

### Roles List

`GET /api/v1/roles?page=0&size=20&search=`

Expected row fields:

```json
{
  "id": 1,
  "name": "Admin",
  "description": "Full access",
  "status": true,
  "permissions": ["VIEW_REPORTS"],
  "createdBy": "admin",
  "createdAt": "2026-06-06T10:00:00"
}
```

### Role Detail

`GET /api/v1/roles/{id}`

### Create Role

`POST /api/v1/roles`

Request:

```json
{
  "name": "Admin",
  "description": "Full access",
  "permissionIds": [1],
  "status": true
}
```

### Update Role

`PUT /api/v1/roles/{id}`

### Delete Role

`DELETE /api/v1/roles/{id}`

### Permissions List

`GET /api/v1/permissions`

Required to build the permissions selector on create/edit role.

## Required APIs For Profile Page

### Current Profile

`GET /api/v1/users/me`

Expected fields:

```json
{
  "id": 1,
  "firstName": "Admin",
  "lastName": "User",
  "userName": "admin",
  "email": "admin@example.com",
  "mobileNo": "9876598765",
  "profilePictureUrl": "https://example.com/profile.png",
  "roleName": "Admin",
  "organizationId": 1
}
```

### Update Profile

`PUT /api/v1/users/me`

Request:

```json
{
  "firstName": "Admin",
  "lastName": "User",
  "email": "admin@example.com",
  "mobileNo": "9876598765"
}
```

### Upload Profile Picture

`POST /api/v1/users/me/profile-picture`

Content type: `multipart/form-data`

Field: `file`

### Change Password

`PUT /api/v1/users/me/password`

Request:

```json
{
  "currentPassword": "old-password",
  "newPassword": "new-password"
}
```

## Optional But Recommended

### Organizations List

`GET /api/v1/organizations`

Required only if users can be created for organizations other than the authenticated user's organization.
