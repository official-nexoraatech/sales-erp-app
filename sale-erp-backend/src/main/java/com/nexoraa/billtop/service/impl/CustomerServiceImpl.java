package com.nexoraa.billtop.service.impl;

import com.nexoraa.billtop.constants.ErrorMessage;
import com.nexoraa.billtop.dto.PageResponseDto;
import com.nexoraa.billtop.dto.customer.CustomerAddressRequestDto;
import com.nexoraa.billtop.dto.customer.CustomerAddressResponseDto;
import com.nexoraa.billtop.dto.customer.CustomerCreateResponseDto;
import com.nexoraa.billtop.dto.customer.CustomerDetailResponseDto;
import com.nexoraa.billtop.dto.customer.CustomerListResponseDto;
import com.nexoraa.billtop.dto.customer.CustomerRequestDto;
import com.nexoraa.billtop.dto.ledger.LedgerResponseDto;
import com.nexoraa.billtop.dto.ledger.LedgerTransactionResponseDto;
import com.nexoraa.billtop.entity.Contact;
import com.nexoraa.billtop.entity.Address;
import com.nexoraa.billtop.entity.Branch;
import com.nexoraa.billtop.entity.Organization;
import com.nexoraa.billtop.entity.Payment;
import com.nexoraa.billtop.entity.Sale;
import com.nexoraa.billtop.entity.SalesReturn;
import com.nexoraa.billtop.entity.State;
import com.nexoraa.billtop.exception.ResourceNotFoundException;
import com.nexoraa.billtop.mapper.CustomerMapper;
import com.nexoraa.billtop.repository.AddressRepository;
import com.nexoraa.billtop.repository.ContactRepository;
import com.nexoraa.billtop.repository.PaymentRepository;
import com.nexoraa.billtop.repository.SaleRepository;
import com.nexoraa.billtop.repository.SalesReturnRepository;
import com.nexoraa.billtop.repository.StateRepository;
import com.nexoraa.billtop.security.CurrentBranchService;
import com.nexoraa.billtop.security.CurrentOrganizationService;
import com.nexoraa.billtop.service.CustomerService;
import com.nexoraa.billtop.specification.ContactSpecification;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

@Service
public class CustomerServiceImpl implements CustomerService {

    private static final String CUSTOMER = "CUSTOMER";
    private static final String BILLING = "BILLING";
    private static final String SHIPPING = "SHIPPING";
    private static final String CANCELLED = "CANCELLED";
    private static final BigDecimal ZERO = BigDecimal.ZERO;
    private static final String WALK_IN_FIRST_NAME = "Walk-in";
    private static final String WALK_IN_LAST_NAME = "Customer";
    private static final String WALK_IN_MOBILE = "0000000000";

    private final ContactRepository contactRepository;
    private final AddressRepository addressRepository;
    private final StateRepository stateRepository;
    private final SaleRepository saleRepository;
    private final SalesReturnRepository salesReturnRepository;
    private final PaymentRepository paymentRepository;
    private final CustomerMapper customerMapper;
    private final CurrentOrganizationService currentOrganizationService;
    private final CurrentBranchService currentBranchService;

    public CustomerServiceImpl(
            ContactRepository contactRepository,
            AddressRepository addressRepository,
            StateRepository stateRepository,
            SaleRepository saleRepository,
            SalesReturnRepository salesReturnRepository,
            PaymentRepository paymentRepository,
            CustomerMapper customerMapper,
            CurrentOrganizationService currentOrganizationService,
            CurrentBranchService currentBranchService
    ) {
        this.contactRepository = contactRepository;
        this.addressRepository = addressRepository;
        this.stateRepository = stateRepository;
        this.saleRepository = saleRepository;
        this.salesReturnRepository = salesReturnRepository;
        this.paymentRepository = paymentRepository;
        this.customerMapper = customerMapper;
        this.currentOrganizationService = currentOrganizationService;
        this.currentBranchService = currentBranchService;
    }

    @Override
    @Transactional
    public CustomerCreateResponseDto createCustomer(CustomerRequestDto request) {
        Organization organization = currentOrganizationService.getOrganizationReference();
        Contact contact = customerMapper.toEntity(request);
        contact.setOrganization(organization);
        contact.setBranch(currentBranchService.getBranchReference());
        Contact savedContact = contactRepository.save(contact);

        saveAddress(savedContact, request.getBillingAddress(), BILLING, organization);
        saveAddress(savedContact, request.getShippingAddress(), SHIPPING, organization);

        return CustomerCreateResponseDto.builder()
                .id(savedContact.getId())
                .customerCode(customerMapper.toCustomerCode(savedContact.getId()))
                .build();
    }

    @Override
    @Transactional
    public void createWalkInCustomerForOrganization(Organization organization, Branch branch) {
        Contact contact = Contact.builder()
                .organization(organization)
                .branch(branch)
                .contactType(CUSTOMER)
                .firstName(WALK_IN_FIRST_NAME)
                .lastName(WALK_IN_LAST_NAME)
                .mobile(WALK_IN_MOBILE)
                .isWholesale(false)
                .build();
        contactRepository.save(contact);
    }

    @Override
    @Transactional
    public void updateCustomer(Long id, CustomerRequestDto request) {
        Contact contact = getActiveCustomer(id);
        Organization organization = contact.getOrganization();
        customerMapper.updateEntity(request, contact);
        contactRepository.save(contact);

        saveAddress(contact, request.getBillingAddress(), BILLING, organization);
        saveAddress(contact, request.getShippingAddress(), SHIPPING, organization);
    }

    @Override
    @Transactional(readOnly = true)
    public CustomerDetailResponseDto getCustomerById(Long id) {
        Contact contact = getActiveCustomer(id);
        CustomerDetailResponseDto response = customerMapper.toDetailResponse(contact);
        response.setCurrentBalance(calculateCustomerBalance(contact));
        response.setBillingAddress(getAddressResponse(id, BILLING));
        response.setShippingAddress(getAddressResponse(id, SHIPPING));
        return response;
    }

    @Override
    @Transactional(readOnly = true)
    public PageResponseDto<CustomerListResponseDto> getCustomers(int page, int size, String search) {
        Specification<Contact> specification = ContactSpecification.activeByType(CUSTOMER)
                .and(ContactSpecification.organization(currentOrganizationService.getOrganizationId()))
                .and(ContactSpecification.branch(currentBranchService.getBranchId()))
                .and(ContactSpecification.search(search));
        Page<Contact> customers = contactRepository.findAll(
                specification,
                PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "id"))
        );
        return PageResponseDto.from(customers.map(customer -> {
            CustomerListResponseDto response = customerMapper.toListResponse(customer);
            response.setBalance(calculateCustomerBalance(customer));
            return response;
        }));
    }

    @Override
    @Transactional
    public void deleteCustomer(Long id) {
        Contact contact = getActiveCustomer(id);
        contact.setStatus(com.nexoraa.billtop.enums.Status.INACTIVE);
        contactRepository.save(contact);
    }

    @Override
    @Transactional(readOnly = true)
    public LedgerResponseDto getCustomerLedger(Long id) {
        Contact customer = getActiveCustomer(id);
        BigDecimal balance = defaultZero(customer.getOpeningBalance());
        List<LedgerEntry> entries = new ArrayList<>();

        for (Sale sale : saleRepository.findByCustomerIdAndOrganizationIdOrderByInvoiceDateAscIdAsc(
                id,
                currentOrganizationService.getOrganizationId()
        )) {
            if (isCancelled(sale.getStatus())) {
                continue;
            }
            BigDecimal amount = defaultZero(sale.getGrandTotal());
            entries.add(new LedgerEntry(sale.getInvoiceDate(), "SALE", sale.getInvoiceNo(), amount, ZERO));
        }

        for (SalesReturn salesReturn : salesReturnRepository.findByCustomerIdAndOrganizationIdOrderByReturnDateAscIdAsc(
                id,
                currentOrganizationService.getOrganizationId()
        )) {
            BigDecimal amount = defaultZero(salesReturn.getGrandTotal());
            entries.add(new LedgerEntry(salesReturn.getReturnDate(), "SALES_RETURN", salesReturn.getReturnNo(), ZERO, amount));
        }

        for (Payment payment : paymentRepository.findByContactIdAndOrganizationIdOrderByPaymentDateAscIdAsc(
                id,
                currentOrganizationService.getOrganizationId()
        )) {
            BigDecimal amount = defaultZero(payment.getAmount());
            entries.add(new LedgerEntry(payment.getPaymentDate(), "PAYMENT", payment.getPaymentNo(), ZERO, amount));
        }

        entries.sort(Comparator.comparing(LedgerEntry::date, Comparator.nullsLast(LocalDate::compareTo)));
        List<LedgerTransactionResponseDto> transactions = new ArrayList<>();
        for (LedgerEntry entry : entries) {
            balance = balance.add(entry.debit()).subtract(entry.credit());
            transactions.add(LedgerTransactionResponseDto.builder()
                    .date(entry.date())
                    .type(entry.type())
                    .referenceNo(entry.referenceNo())
                    .debit(entry.debit())
                    .credit(entry.credit())
                    .balance(balance)
                    .build());
        }

        return LedgerResponseDto.builder()
                .openingBalance(defaultZero(customer.getOpeningBalance()))
                .transactions(transactions)
                .build();
    }

    private Contact getActiveCustomer(Long id) {
        return contactRepository.findByIdAndContactTypeAndOrganizationIdAndBranchIdAndStatus(
                        id,
                        CUSTOMER,
                        currentOrganizationService.getOrganizationId(),
                        currentBranchService.getBranchId(),
                com.nexoraa.billtop.enums.Status.ACTIVE)
                .orElseThrow(() -> new ResourceNotFoundException(ErrorMessage.CUSTOMER_NOT_FOUND, "CUSTOMER_NOT_FOUND"));
    }

    private void saveAddress(
            Contact contact,
            CustomerAddressRequestDto request,
            String addressType,
            Organization organization
    ) {
        if (request == null) {
            return;
        }

        Address address = addressRepository.findByContactIdAndAddressTypeAndOrganizationId(
                        contact.getId(),
                        addressType,
                        currentOrganizationService.getOrganizationId()
                )
                .orElseGet(Address::new);
        boolean isNewAddress = address.getId() == null;

        customerMapper.updateAddressEntity(request, address);
        address.setOrganization(organization);
        address.setContact(contact);
        address.setAddressType(addressType);
        address.setState(getActiveState(request.getStateId()));
        if (isNewAddress) {
        }
        addressRepository.save(address);
    }

    private CustomerAddressResponseDto getAddressResponse(Long contactId, String addressType) {
        return addressRepository.findByContactIdAndAddressTypeAndOrganizationId(
                        contactId,
                        addressType,
                        currentOrganizationService.getOrganizationId()
                )
                .map(customerMapper::toAddressResponse)
                .orElse(null);
    }

    private State getActiveState(Long id) {
        return stateRepository.findByIdAndStatus(id, com.nexoraa.billtop.enums.Status.ACTIVE)
                .orElseThrow(() -> new ResourceNotFoundException(ErrorMessage.STATE_NOT_FOUND, "STATE_NOT_FOUND"));
    }

    private BigDecimal defaultZero(BigDecimal value) {
        return value == null ? ZERO : value;
    }

    private BigDecimal calculateCustomerBalance(Contact customer) {
        BigDecimal salesTotal = saleRepository.findByCustomerIdAndOrganizationIdOrderByInvoiceDateAscIdAsc(
                        customer.getId(),
                        currentOrganizationService.getOrganizationId()
                )
                .stream()
                .filter(sale -> !isCancelled(sale.getStatus()))
                .map(Sale::getGrandTotal)
                .map(this::defaultZero)
                .reduce(ZERO, BigDecimal::add);
        BigDecimal salesReturnTotal = salesReturnRepository.findByCustomerIdAndOrganizationIdOrderByReturnDateAscIdAsc(
                        customer.getId(),
                        currentOrganizationService.getOrganizationId()
                )
                .stream()
                .map(SalesReturn::getGrandTotal)
                .map(this::defaultZero)
                .reduce(ZERO, BigDecimal::add);
        BigDecimal paymentsTotal = paymentRepository.findByContactIdAndOrganizationIdOrderByPaymentDateAscIdAsc(
                        customer.getId(),
                        currentOrganizationService.getOrganizationId()
                )
                .stream()
                .map(Payment::getAmount)
                .map(this::defaultZero)
                .reduce(ZERO, BigDecimal::add);
        return defaultZero(customer.getOpeningBalance()).add(salesTotal).subtract(salesReturnTotal).subtract(paymentsTotal);
    }

    private boolean isCancelled(String status) {
        return CANCELLED.equalsIgnoreCase(status);
    }

    private record LedgerEntry(LocalDate date, String type, String referenceNo, BigDecimal debit, BigDecimal credit) {
    }
}





