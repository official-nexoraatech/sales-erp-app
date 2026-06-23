CREATE TABLE IF NOT EXISTS user_permission_mapping (
    user_id BIGINT NOT NULL,
    permission_id BIGINT NOT NULL,
    PRIMARY KEY (user_id, permission_id),
    CONSTRAINT fk_user_permission_mapping_user FOREIGN KEY (user_id) REFERENCES users (id),
    CONSTRAINT fk_user_permission_mapping_permission FOREIGN KEY (permission_id) REFERENCES permissions (id)
);

CREATE INDEX IF NOT EXISTS idx_user_permission_mapping_user_id ON user_permission_mapping (user_id);
CREATE INDEX IF NOT EXISTS idx_user_permission_mapping_permission_id ON user_permission_mapping (permission_id);
