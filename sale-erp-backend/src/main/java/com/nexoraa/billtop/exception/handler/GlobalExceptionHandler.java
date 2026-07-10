package com.nexoraa.billtop.exception.handler;

import com.nexoraa.billtop.constants.ErrorMessage;
import com.nexoraa.billtop.dto.ErrorResponseDto;
import com.nexoraa.billtop.exception.ApplicationException;
import com.nexoraa.billtop.exception.FileStorageException;
import com.nexoraa.billtop.exception.ResourceNotFoundException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.ConstraintViolationException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.dao.DataAccessException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.authentication.DisabledException;
import org.springframework.security.core.AuthenticationException;
import org.springframework.util.StringUtils;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import jakarta.persistence.PersistenceException;
import java.util.Map;
import java.util.stream.Collectors;

@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(BadCredentialsException.class)
    public ResponseEntity<ErrorResponseDto> handleBadCredentials(BadCredentialsException ex, HttpServletRequest request) {
        HttpStatus status = HttpStatus.UNAUTHORIZED;
        logException(ex, status, "INVALID_CREDENTIALS", request);
        return ResponseEntity.status(status)
                .body(ErrorResponseDto.error(ErrorMessage.INVALID_CREDENTIALS, "INVALID_CREDENTIALS"));
    }

    @ExceptionHandler({AuthenticationException.class, DisabledException.class})
    public ResponseEntity<ErrorResponseDto> handleAuthentication(Exception ex, HttpServletRequest request) {
        HttpStatus status = HttpStatus.UNAUTHORIZED;
        logException(ex, status, "UNAUTHORIZED", request);
        return ResponseEntity.status(status)
                .body(ErrorResponseDto.error(ErrorMessage.UNAUTHORIZED, "UNAUTHORIZED"));
    }

    @ExceptionHandler(org.springframework.security.access.AccessDeniedException.class)
    public ResponseEntity<ErrorResponseDto> handleSpringAccessDenied(
            org.springframework.security.access.AccessDeniedException ex,
            HttpServletRequest request
    ) {
        HttpStatus status = HttpStatus.FORBIDDEN;
        logException(ex, status, "FORBIDDEN", request);
        return ResponseEntity.status(status)
                .body(ErrorResponseDto.error(ErrorMessage.FORBIDDEN, "FORBIDDEN"));
    }

    @ExceptionHandler(com.nexoraa.billtop.exception.AccessDeniedException.class)
    public ResponseEntity<ErrorResponseDto> handleApplicationAccessDenied(
            com.nexoraa.billtop.exception.AccessDeniedException ex,
            HttpServletRequest request
    ) {
        HttpStatus status = HttpStatus.FORBIDDEN;
        logException(ex, status, ex.getErrorCode(), request);
        return ResponseEntity.status(status)
                .body(ErrorResponseDto.error(ex.getMessage(), ex.getErrorCode()));
    }

    @ExceptionHandler(ResourceNotFoundException.class)
    public ResponseEntity<ErrorResponseDto> handleResourceNotFound(ResourceNotFoundException ex, HttpServletRequest request) {
        HttpStatus status = HttpStatus.NOT_FOUND;
        logException(ex, status, ex.getErrorCode(), request);
        return ResponseEntity.status(status)
                .body(ErrorResponseDto.error(ex.getMessage(), ex.getErrorCode()));
    }

    @ExceptionHandler(FileStorageException.class)
    public ResponseEntity<ErrorResponseDto> handleFileStorageException(FileStorageException ex, HttpServletRequest request) {
        HttpStatus status = HttpStatus.INTERNAL_SERVER_ERROR;
        logException(ex, status, ex.getErrorCode(), request);
        return ResponseEntity.status(status)
                .body(ErrorResponseDto.error(ex.getMessage(), ex.getErrorCode()));
    }

    @ExceptionHandler(ApplicationException.class)
    public ResponseEntity<ErrorResponseDto> handleApplicationException(ApplicationException ex, HttpServletRequest request) {
        HttpStatus status = HttpStatus.BAD_REQUEST;
        logException(ex, status, ex.getErrorCode(), request);
        return ResponseEntity.status(status)
                .body(ErrorResponseDto.error(ex.getMessage(), ex.getErrorCode()));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ErrorResponseDto> handleValidation(MethodArgumentNotValidException ex, HttpServletRequest request) {
        HttpStatus status = HttpStatus.BAD_REQUEST;
        logException(ex, status, "VALIDATION_FAILED", request);
        Map<String, String> errors = ex.getBindingResult().getFieldErrors().stream()
                .collect(Collectors.toMap(
                        FieldError::getField,
                        fieldError -> String.valueOf(fieldError.getDefaultMessage()),
                        (left, right) -> left
                ));
        return ResponseEntity.status(status)
                .body(ErrorResponseDto.error(ErrorMessage.VALIDATION_FAILED, "VALIDATION_FAILED", errors));
    }

    @ExceptionHandler(ConstraintViolationException.class)
    public ResponseEntity<ErrorResponseDto> handleConstraintViolation(ConstraintViolationException ex, HttpServletRequest request) {
        HttpStatus status = HttpStatus.BAD_REQUEST;
        logException(ex, status, "VALIDATION_FAILED", request);
        return ResponseEntity.status(status)
                .body(ErrorResponseDto.error(ErrorMessage.VALIDATION_FAILED, "VALIDATION_FAILED", ex.getMessage()));
    }

    @ExceptionHandler(DataIntegrityViolationException.class)
    public ResponseEntity<ErrorResponseDto> handleDataIntegrityViolation(DataIntegrityViolationException ex, HttpServletRequest request) {
        HttpStatus status = HttpStatus.BAD_REQUEST;
        logException(ex, status, "DATA_INTEGRITY_VIOLATION", request);
        return ResponseEntity.status(status)
                .body(ErrorResponseDto.error(ErrorMessage.DATA_INTEGRITY_VIOLATION, "DATA_INTEGRITY_VIOLATION"));
    }

    @ExceptionHandler(org.hibernate.exception.ConstraintViolationException.class)
    public ResponseEntity<ErrorResponseDto> handleHibernateConstraintViolation(
            org.hibernate.exception.ConstraintViolationException ex,
            HttpServletRequest request
    ) {
        HttpStatus status = HttpStatus.BAD_REQUEST;
        logException(ex, status, "DATA_INTEGRITY_VIOLATION", request);
        return ResponseEntity.status(status)
                .body(ErrorResponseDto.error(ErrorMessage.DATA_INTEGRITY_VIOLATION, "DATA_INTEGRITY_VIOLATION"));
    }

    @ExceptionHandler({DataAccessException.class, PersistenceException.class})
    public ResponseEntity<ErrorResponseDto> handleDatabaseException(Exception ex, HttpServletRequest request) {
        HttpStatus status = HttpStatus.INTERNAL_SERVER_ERROR;
        logException(ex, status, "DATABASE_ERROR", request);
        return ResponseEntity.status(status)
                .body(ErrorResponseDto.error(ErrorMessage.DATABASE_ERROR, "DATABASE_ERROR"));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ErrorResponseDto> handleUnexpected(Exception ex, HttpServletRequest request) {
        HttpStatus status = HttpStatus.INTERNAL_SERVER_ERROR;
        logException(ex, status, "INTERNAL_SERVER_ERROR", request);
        return ResponseEntity.status(status)
                .body(ErrorResponseDto.error(ErrorMessage.INTERNAL_SERVER_ERROR, "INTERNAL_SERVER_ERROR"));
    }

    private void logException(Throwable ex, HttpStatus status, String errorCode, HttpServletRequest request) {
        String method = request != null ? request.getMethod() : "N/A";
        String path = request != null ? request.getRequestURI() : "N/A";
        String rootCause = resolveExceptionMessage(ex);

        if (status.is5xxServerError()) {
            log.error(
                    "Request exception handled. status={}, errorCode={}, method={}, path={}, exception={}, message={}, rootCause={}",
                    status.value(),
                    errorCode,
                    method,
                    path,
                    ex.getClass().getName(),
                    ex.getMessage(),
                    rootCause,
                    ex
            );
            return;
        }

        log.warn(
                "Request exception handled. status={}, errorCode={}, method={}, path={}, exception={}, message={}, rootCause={}",
                status.value(),
                errorCode,
                method,
                path,
                ex.getClass().getName(),
                ex.getMessage(),
                rootCause,
                ex
        );
    }

    private String resolveExceptionMessage(Throwable ex) {
        Throwable cause = ex;
        while (cause.getCause() != null && cause.getCause() != cause) {
            cause = cause.getCause();
        }

        String message = cause.getMessage();
        if (!StringUtils.hasText(message)) {
            message = ex.getMessage();
        }
        return StringUtils.hasText(message) ? message : ErrorMessage.OPERATION_FAILED;
    }
}
