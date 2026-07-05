package com.nexoraa.billtop.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;
import java.util.HashMap;
import java.util.Map;
import java.util.List;

/**
 * Configuration properties for loading permissions from YAML file.
 * This class reads the permissions-config.yaml file and makes permissions available
 * throughout the application for role-based access control.
 *
 * The permissions are persisted in the database via Flyway migration:
 * - File: db/migration/V3__insert_permissions.sql
 * - Table: permissions
 *
 * Usage:
 * - Inject PermissionConfigProperties into any service
 * - Access permissions by group: getPermissions(groupName)
 * - All permissions are also available in the database
 */
@Component
@ConfigurationProperties(prefix = "permissions")
public class PermissionConfigProperties {

    private Map<String, PermissionGroup> permissions = new HashMap<>();

    public Map<String, PermissionGroup> getPermissions() {
        return permissions;
    }

    public void setPermissions(Map<String, PermissionGroup> permissions) {
        this.permissions = permissions;
    }

    /**
     * Get all permissions for a specific module/group
     * 
     * @param groupKey The key of the permission group (e.g., "item", "brand")
     * @return List of permissions in the group
     */
    public List<Permission> getPermissionsByGroup(String groupKey) {
        if (permissions.containsKey(groupKey)) {
            return permissions.get(groupKey).getPermissions();
        }
        return List.of();
    }

    /**
     * Get all permission groups
     * 
     * @return List of all permission groups
     */
    public List<String> getAllGroups() {
        return List.copyOf(permissions.keySet());
    }

    public static class PermissionGroup {
        private String group;
        private List<Permission> permissions;

        public String getGroup() {
            return group;
        }

        public void setGroup(String group) {
            this.group = group;
        }

        public List<Permission> getPermissions() {
            return permissions;
        }

        public void setPermissions(List<Permission> permissions) {
            this.permissions = permissions;
        }
    }

    public static class Permission {
        private String name;
        private String description;
        private String endpoint;

        public String getName() {
            return name;
        }

        public void setName(String name) {
            this.name = name;
        }

        public String getDescription() {
            return description;
        }

        public void setDescription(String description) {
            this.description = description;
        }

        public String getEndpoint() {
            return endpoint;
        }

        public void setEndpoint(String endpoint) {
            this.endpoint = endpoint;
        }

        @Override
        public String toString() {
            return "Permission{" +
                    "name='" + name + '\'' +
                    ", description='" + description + '\'' +
                    ", endpoint='" + endpoint + '\'' +
                    '}';
        }
    }
}
