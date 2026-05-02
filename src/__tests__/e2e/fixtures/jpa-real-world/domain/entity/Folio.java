package domain.entity;

import jakarta.persistence.*;
import java.util.UUID;

@Entity
@Table(name = "folios")
public class Folio extends BaseEntity {

    @Column(name = "folio_number", nullable = false, length = 30)
    private String folioNumber;

    @Column(name = "amc_id", nullable = false)
    private UUID amcId;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "holder_name", nullable = false, length = 255)
    private String holderName;

    @Column(name = "pan", length = 10)
    private String pan;

    @Column(name = "is_active", nullable = false)
    private boolean isActive;
}
