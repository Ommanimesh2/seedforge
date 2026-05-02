package domain.entity;

import jakarta.persistence.*;
import commons.valueobject.SchemeType;

import java.util.UUID;

@Entity
@Table(name = "schemes")
public class Scheme extends BaseEntity {

    @Column(name = "amc_id", nullable = false)
    private UUID amcId;

    @Column(name = "scheme_code", nullable = false, length = 50)
    private String schemeCode;

    @Column(name = "name", nullable = false, length = 200)
    private String name;

    @Enumerated(EnumType.STRING)
    @Column(name = "scheme_type", length = 20)
    private SchemeType schemeType;

    @Column(name = "active", nullable = false)
    private boolean active;
}
