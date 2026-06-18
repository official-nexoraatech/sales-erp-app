package com.nexoraa.billtop.exception;

/**
 * Base exception class for all application exceptions.
 */
public class ApplicationException extends RuntimeException {

    private String errorCode;

    public ApplicationException(String message) {
        super(message);
        this.errorCode = "ERROR";
    }

    public ApplicationException(String message, String errorCode) {
        super(message);
        this.errorCode = errorCode;
    }

    public ApplicationException(String message, Throwable cause) {
        super(message, cause);
        this.errorCode = "ERROR";
    }

    public ApplicationException(String message, String errorCode, Throwable cause) {
        super(message, cause);
        this.errorCode = errorCode;
    }

    public String getErrorCode() {

        return errorCode;
    }

    public void setErrorCode(String errorCode) {
        this.errorCode = errorCode;
    }
}

