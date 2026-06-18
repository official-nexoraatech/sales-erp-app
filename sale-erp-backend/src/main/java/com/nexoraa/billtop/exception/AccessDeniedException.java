package com.nexoraa.billtop.exception;

/**
 * Exception thrown when user lacks required permissions.
 */
public class AccessDeniedException extends ApplicationException {

    public AccessDeniedException(String message) {
        super(message, "FORBIDDEN");
    }

    public AccessDeniedException(String message, String errorCode) {
        super(message, errorCode);
    }
}

